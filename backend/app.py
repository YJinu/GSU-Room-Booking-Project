from flask import Flask, request, jsonify, session, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timezone, timedelta
from sqlalchemy import inspect, text, func
from sqlalchemy.exc import IntegrityError
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['SESSION_COOKIE_NAME'] = 'roombooking_session'
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = False
app.config['REMEMBER_COOKIE_NAME'] = 'roombooking_remember'
app.config['REMEMBER_COOKIE_SECURE'] = False
app.config['REMEMBER_COOKIE_HTTPONLY'] = True
app.config['REMEMBER_COOKIE_SAMESITE'] = 'Lax'
app.config['REMEMBER_COOKIE_DURATION'] = timedelta(days=30)
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///roombooking.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
CORS(app, supports_credentials=True, origins=['http://localhost:8000', 'http://127.0.0.1:8000'])
login_manager = LoginManager(app)
login_manager.login_view = 'login'

@login_manager.unauthorized_handler
def unauthorized():
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Authentication required'}), 401
    return redirect(url_for('login'))

# =============================================
# DATABASE MODELS
# =============================================

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    first_name = db.Column(db.String(80), nullable=False)
    last_name = db.Column(db.String(80), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='user')  # 'admin' or 'user'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    bookings = db.relationship('Booking', backref='user', lazy=True, foreign_keys='Booking.user_id')

class Room(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    location = db.Column(db.String(200), nullable=False)
    capacity = db.Column(db.Integer, nullable=False)
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    bookings = db.relationship('Booking', backref='room', lazy=True, cascade='all, delete-orphan')

class Booking(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey('room.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    date = db.Column(db.String(10), nullable=False)  # 'YYYY-MM-DD'
    start_time = db.Column(db.String(5), nullable=False)  # 'HH:MM'
    end_time = db.Column(db.String(5), nullable=False)    # 'HH:MM'
    status = db.Column(db.String(20), default='booked')   # 'booked' or 'canceled'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class AdminAction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    booking_id = db.Column(db.Integer, db.ForeignKey('booking.id'), nullable=False)
    action = db.Column(db.String(20), nullable=False)  # 'cancel' or 'remove'
    note = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    admin = db.relationship('User', backref='admin_actions', lazy=True)
    booking = db.relationship('Booking', backref='admin_actions', lazy=True)


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


def _to_utc_iso(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z')


def _check_overlap(room_id, date, start_time, end_time, exclude_booking_id=None):
    """Check if a booking overlaps with existing booked slots for the same room/date."""
    query = Booking.query.filter_by(room_id=room_id, date=date, status='booked')
    if exclude_booking_id:
        query = query.filter(Booking.id != exclude_booking_id)
    existing = query.all()
    for b in existing:
        # Overlap: new_start < existing_end AND new_end > existing_start
        if start_time < b.end_time and end_time > b.start_time:
            return True
    return False


def _check_overlap_sql(conn, room_id, date, start_time, end_time, exclude_booking_id=None):
    """Run the overlap check inside the same DB transaction used for booking creation."""
    sql = """
        SELECT id
        FROM booking
        WHERE room_id = :room_id
          AND date = :date
          AND status = 'booked'
          AND :start_time < end_time
          AND :end_time > start_time
    """
    params = {
        'room_id': room_id,
        'date': date,
        'start_time': start_time,
        'end_time': end_time,
    }

    if exclude_booking_id is not None:
        sql += ' AND id != :exclude_booking_id'
        params['exclude_booking_id'] = exclude_booking_id

    sql += ' LIMIT 1'
    return conn.execute(text(sql), params).first() is not None


def _create_booking_atomically(room_id, user_id, date, start_time, end_time):
    """Create a booking with SQLite write-locking so parallel requests cannot double-book the room."""
    conn = db.engine.connect()
    try:
        # SQLite cannot enforce range-overlap exclusions natively, so we serialize booking writes.
        # BEGIN IMMEDIATE acquires the write lock before we re-check availability.
        conn.exec_driver_sql('BEGIN IMMEDIATE')

        if _check_overlap_sql(conn, room_id, date, start_time, end_time):
            conn.rollback()
            return None, 'Time slot conflicts with an existing booking. Please choose a different time.'

        result = conn.execute(text("""
            INSERT INTO booking (room_id, user_id, date, start_time, end_time, status, created_at)
            VALUES (:room_id, :user_id, :date, :start_time, :end_time, 'booked', :created_at)
        """), {
            'room_id': room_id,
            'user_id': user_id,
            'date': date,
            'start_time': start_time,
            'end_time': end_time,
            'created_at': datetime.utcnow(),
        })
        conn.commit()
        return result.lastrowid, None
    except IntegrityError:
        conn.rollback()
        return None, 'Time slot conflicts with an existing booking. Please choose a different time.'
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# =============================================
# AUTH ROUTES
# =============================================

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json

    if not data.get('username') or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Username, email, and password are required'}), 400

    if not data.get('first_name') or not data.get('last_name'):
        return jsonify({'error': 'First and last name are required'}), 400

    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': 'Username already exists'}), 400

    if User.query.filter_by(email=data['email']).first():
        return jsonify({'error': 'Email already registered'}), 400

    user = User(
        username=data['username'],
        email=data['email'],
        password_hash=generate_password_hash(data['password']),
        first_name=data['first_name'],
        last_name=data['last_name'],
        role='user'
    )

    db.session.add(user)
    db.session.commit()

    return jsonify({'message': 'Registration successful', 'user_id': user.id}), 201


@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data.get('username')).first()

    if user and check_password_hash(user.password_hash, data.get('password')):
        login_user(user, remember=True)
        session.permanent = True
        return jsonify({
            'message': 'Login successful',
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'role': user.role
            }
        }), 200

    return jsonify({'error': 'Invalid credentials'}), 401


@app.route('/api/current-user', methods=['GET'])
@login_required
def get_current_user():
    return jsonify({
        'id': current_user.id,
        'username': current_user.username,
        'email': current_user.email,
        'first_name': current_user.first_name,
        'last_name': current_user.last_name,
        'role': current_user.role
    }), 200


@app.route('/api/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return jsonify({'message': 'Logout successful'}), 200


# =============================================
# ROOM ROUTES
# =============================================

@app.route('/api/rooms', methods=['GET', 'POST'])
@login_required
def rooms():
    if request.method == 'GET':
        keyword = request.args.get('keyword', '')
        query = Room.query

        if keyword:
            query = query.filter(
                (Room.name.contains(keyword)) |
                (Room.location.contains(keyword)) |
                (Room.description.contains(keyword))
            )

        rooms_list = query.order_by(Room.name).all()
        return jsonify([{
            'id': r.id,
            'name': r.name,
            'location': r.location,
            'capacity': r.capacity,
            'description': r.description,
            'created_at': _to_utc_iso(r.created_at)
        } for r in rooms_list]), 200

    elif request.method == 'POST':
        if current_user.role != 'admin':
            return jsonify({'error': 'Only admins can create rooms'}), 403

        data = request.json
        if not data.get('name') or not data.get('location') or not data.get('capacity'):
            return jsonify({'error': 'Name, location, and capacity are required'}), 400

        room = Room(
            name=data['name'],
            location=data['location'],
            capacity=int(data['capacity']),
            description=data.get('description', '')
        )
        db.session.add(room)
        db.session.commit()

        return jsonify({'message': 'Room created successfully', 'room_id': room.id}), 201


@app.route('/api/rooms/<int:room_id>', methods=['GET', 'PUT', 'DELETE'])
@login_required
def room_detail(room_id):
    room = Room.query.get_or_404(room_id)

    if request.method == 'GET':
        return jsonify({
            'id': room.id,
            'name': room.name,
            'location': room.location,
            'capacity': room.capacity,
            'description': room.description,
            'created_at': _to_utc_iso(room.created_at)
        }), 200

    elif request.method == 'PUT':
        if current_user.role != 'admin':
            return jsonify({'error': 'Only admins can edit rooms'}), 403

        data = request.json
        room.name = data.get('name', room.name)
        room.location = data.get('location', room.location)
        room.capacity = data.get('capacity', room.capacity)
        room.description = data.get('description', room.description)
        db.session.commit()
        return jsonify({'message': 'Room updated successfully'}), 200

    elif request.method == 'DELETE':
        if current_user.role != 'admin':
            return jsonify({'error': 'Only admins can delete rooms'}), 403

        db.session.delete(room)
        db.session.commit()
        return jsonify({'message': 'Room deleted successfully'}), 200


@app.route('/api/rooms/<int:room_id>/availability', methods=['GET'])
@login_required
def room_availability(room_id):
    """Get booked time slots for a room on a given date."""
    room = Room.query.get_or_404(room_id)
    date = request.args.get('date')
    if not date:
        return jsonify({'error': 'Date parameter is required'}), 400

    bookings = Booking.query.filter_by(room_id=room_id, date=date, status='booked').order_by(Booking.start_time).all()
    return jsonify({
        'room_id': room.id,
        'room_name': room.name,
        'date': date,
        'booked_slots': [{
            'id': b.id,
            'start_time': b.start_time,
            'end_time': b.end_time,
            'user_id': b.user_id,
            'user_name': f"{b.user.first_name} {b.user.last_name}"
        } for b in bookings]
    }), 200


# =============================================
# BOOKING ROUTES
# =============================================

@app.route('/api/bookings', methods=['GET', 'POST'])
@login_required
def bookings():
    if request.method == 'GET':
        # Admin sees all bookings, user sees only their own
        if current_user.role == 'admin':
            query = Booking.query
        else:
            query = Booking.query.filter_by(user_id=current_user.id)

        status_filter = request.args.get('status')
        if status_filter:
            query = query.filter_by(status=status_filter)

        bookings_list = query.order_by(Booking.date.desc(), Booking.start_time.desc()).all()
        return jsonify([{
            'id': b.id,
            'room_id': b.room_id,
            'room_name': b.room.name,
            'room_location': b.room.location,
            'user_id': b.user_id,
            'user_name': f"{b.user.first_name} {b.user.last_name}",
            'date': b.date,
            'start_time': b.start_time,
            'end_time': b.end_time,
            'status': b.status,
            'created_at': _to_utc_iso(b.created_at)
        } for b in bookings_list]), 200

    elif request.method == 'POST':
        data = request.json
        room_id = data.get('room_id')
        date = data.get('date')
        start_time = data.get('start_time')
        end_time = data.get('end_time')

        if not all([room_id, date, start_time, end_time]):
            return jsonify({'error': 'Room, date, start time, and end time are required'}), 400

        room = Room.query.get(room_id)
        if not room:
            return jsonify({'error': 'Room not found'}), 404

        # Validate times
        if start_time >= end_time:
            return jsonify({'error': 'End time must be after start time'}), 400

        # Fast pre-check for normal requests before we take the write lock.
        if _check_overlap(room_id, date, start_time, end_time):
            return jsonify({'error': 'Time slot conflicts with an existing booking. Please choose a different time.'}), 409

        booking_id, conflict_error = _create_booking_atomically(
            room_id=room_id,
            user_id=current_user.id,
            date=date,
            start_time=start_time,
            end_time=end_time
        )
        if conflict_error:
            return jsonify({'error': conflict_error}), 409

        return jsonify({'message': 'Room booked successfully', 'booking_id': booking_id}), 201


@app.route('/api/bookings/<int:booking_id>', methods=['GET'])
@login_required
def booking_detail(booking_id):
    booking = Booking.query.get_or_404(booking_id)

    if current_user.role != 'admin' and booking.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    return jsonify({
        'id': booking.id,
        'room_id': booking.room_id,
        'room_name': booking.room.name,
        'room_location': booking.room.location,
        'user_id': booking.user_id,
        'user_name': f"{booking.user.first_name} {booking.user.last_name}",
        'date': booking.date,
        'start_time': booking.start_time,
        'end_time': booking.end_time,
        'status': booking.status,
        'created_at': _to_utc_iso(booking.created_at)
    }), 200


@app.route('/api/bookings/<int:booking_id>/cancel', methods=['POST'])
@login_required
def cancel_booking(booking_id):
    booking = Booking.query.get_or_404(booking_id)

    # Users can cancel their own bookings; admins can cancel any
    if current_user.role != 'admin' and booking.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    if booking.status == 'canceled':
        return jsonify({'error': 'Booking is already canceled'}), 400

    booking.status = 'canceled'

    # If admin cancels someone else's booking, log the action
    if current_user.role == 'admin' and booking.user_id != current_user.id:
        data = request.json or {}
        action = AdminAction(
            admin_id=current_user.id,
            booking_id=booking.id,
            action='cancel',
            note=data.get('note', '')
        )
        db.session.add(action)

    db.session.commit()

    return jsonify({'message': 'Booking canceled successfully'}), 200


# =============================================
# ADMIN ROUTES
# =============================================

@app.route('/api/admin/bookings', methods=['GET'])
@login_required
def admin_all_bookings():
    """Admin: get all bookings with filters"""
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    status_filter = request.args.get('status')
    room_filter = request.args.get('room_id')
    date_filter = request.args.get('date')

    query = Booking.query

    if status_filter:
        query = query.filter_by(status=status_filter)
    if room_filter:
        query = query.filter_by(room_id=int(room_filter))
    if date_filter:
        query = query.filter_by(date=date_filter)

    bookings_list = query.order_by(Booking.date.desc(), Booking.start_time.desc()).all()
    return jsonify([{
        'id': b.id,
        'room_id': b.room_id,
        'room_name': b.room.name,
        'room_location': b.room.location,
        'user_id': b.user_id,
        'user_name': f"{b.user.first_name} {b.user.last_name}",
        'date': b.date,
        'start_time': b.start_time,
        'end_time': b.end_time,
        'status': b.status,
        'created_at': _to_utc_iso(b.created_at)
    } for b in bookings_list]), 200


@app.route('/api/admin/stats', methods=['GET'])
@login_required
def admin_stats():
    """Admin dashboard statistics."""
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    total_rooms = Room.query.count()
    total_users = User.query.filter_by(role='user').count()
    total_bookings = Booking.query.filter_by(status='booked').count()
    total_canceled = Booking.query.filter_by(status='canceled').count()

    # Bookings per room
    room_stats = db.session.query(
        Room.name,
        func.count(Booking.id)
    ).outerjoin(Booking, (Booking.room_id == Room.id) & (Booking.status == 'booked')).group_by(Room.id).all()

    # Bookings per day of the week (for the last 30 days)
    thirty_days_ago = (datetime.utcnow() - timedelta(days=30)).strftime('%Y-%m-%d')
    recent_bookings = Booking.query.filter(
        Booking.status == 'booked',
        Booking.date >= thirty_days_ago
    ).all()

    day_counts = {}
    for b in recent_bookings:
        try:
            d = datetime.strptime(b.date, '%Y-%m-%d')
            day_name = d.strftime('%A')
            day_counts[day_name] = day_counts.get(day_name, 0) + 1
        except ValueError:
            pass

    # Most popular room
    most_popular = None
    if room_stats:
        sorted_rooms = sorted(room_stats, key=lambda x: x[1], reverse=True)
        if sorted_rooms[0][1] > 0:
            most_popular = sorted_rooms[0][0]

    return jsonify({
        'total_rooms': total_rooms,
        'total_users': total_users,
        'total_bookings': total_bookings,
        'total_canceled': total_canceled,
        'room_stats': [{'room_name': name, 'booking_count': count} for name, count in room_stats],
        'weekly_distribution': day_counts,
        'most_popular_room': most_popular
    }), 200


@app.route('/api/admin/actions', methods=['GET'])
@login_required
def admin_action_log():
    """Get admin action log."""
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    actions = AdminAction.query.order_by(AdminAction.created_at.desc()).all()
    return jsonify([{
        'id': a.id,
        'admin_name': f"{a.admin.first_name} {a.admin.last_name}",
        'booking_id': a.booking_id,
        'action': a.action,
        'note': a.note,
        'created_at': _to_utc_iso(a.created_at)
    } for a in actions]), 200


# =============================================
# SEED DATA
# =============================================

def seed_sample_data():
    """Create sample rooms and admin user if database is empty."""
    if User.query.count() > 0:
        return

    # Create admin
    admin = User(
        username='admin',
        email='admin@gsu.edu',
        password_hash=generate_password_hash('admin123'),
        first_name='System',
        last_name='Admin',
        role='admin'
    )
    db.session.add(admin)

    # Create sample user
    user = User(
        username='jdoe',
        email='jdoe@student.gsu.edu',
        password_hash=generate_password_hash('password123'),
        first_name='John',
        last_name='Doe',
        role='user'
    )
    db.session.add(user)

    # Create sample rooms
    sample_rooms = [
        Room(name='Conference Room A', location='Aderhold Hall, Room 101', capacity=10, description='Large conference room with projector and whiteboard.'),
        Room(name='Study Room B', location='Library South, Room 210', capacity=4, description='Quiet study room with power outlets.'),
        Room(name='Lab Room C', location='25 Park Place, Room 305', capacity=20, description='Computer lab with 20 workstations.'),
        Room(name='Meeting Room D', location='Student Center, Room 402', capacity=6, description='Small meeting room for group work.'),
        Room(name='Seminar Room E', location='Langdale Hall, Room 108', capacity=30, description='Large seminar room with AV equipment.'),
    ]
    for r in sample_rooms:
        db.session.add(r)

    # Create a sample booking
    db.session.flush()
    today = datetime.utcnow().strftime('%Y-%m-%d')
    sample_booking = Booking(
        room_id=sample_rooms[0].id,
        user_id=user.id,
        date=today,
        start_time='10:00',
        end_time='11:00',
        status='booked'
    )
    db.session.add(sample_booking)

    db.session.commit()
    print("Sample data seeded successfully.")


# Initialize database
with app.app_context():
    db.create_all()
    db.session.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_exact_slot_active
        ON booking (room_id, date, start_time, end_time)
        WHERE status = 'booked'
    """))
    db.session.commit()
    seed_sample_data()

if __name__ == '__main__':
    from waitress import serve
    print('Backend running on http://0.0.0.0:5001')
    serve(app, host='0.0.0.0', port=5001)
