# GSU Room Booking

**CSC 4370 – Web Programming Project | Spring 2026**

A Room/Resource Booking web application where users can view available rooms and book time slots without conflicts. The system prevents double-booking and allows users to cancel their reservations.

## Team

- **Lincoln Thomas** (lthomas130@student.gsu.edu) – Frontend development
- **Yin Wang** (ywang173@student.gsu.edu) – Backend development

---

## Quick Start

### Option 1: Automated (Recommended)

**Linux/Mac:**
```bash
chmod +x start.sh
./start.sh
```

**Windows:**
```
start.bat
```

Then open: **http://localhost:8000**

### Option 2: Manual Setup

**Step 1: Install dependencies**
```bash
pip install -r requirements.txt --break-system-packages
```

**Step 2: Start backend** (terminal 1)
```bash
cd backend
python app.py
```

**Step 3: Start frontend** (terminal 2)
```bash
cd frontend
python -m http.server 8000
```

**Step 4:** Open http://localhost:8000

### Sample Login Credentials

| Role  | Username | Password    |
|-------|----------|-------------|
| Admin | `admin`  | `admin123`  |
| User  | `jdoe`   | `password123` |

---

## Project Structure

```
GSU-Room-Booking/
├── backend/
│   └── app.py              # Flask API (all routes + models)
├── frontend/
│   ├── index.html           # Main UI (all pages/views)
│   ├── styles.css           # Styling
│   └── app.js               # Frontend logic
├── requirements.txt         # Python dependencies
├── start.sh                 # Linux/Mac startup script
├── start.bat                # Windows startup script
├── .gitignore
├── .env.example
└── README.md
```

---

## Roles & Permissions

### Admin
- Add, edit, and remove rooms/resources
- View all bookings from all users
- Cancel inappropriate or invalid bookings (with notes logged)
- View booking statistics dashboard (bookings per room, most used rooms, weekly trends)

### User
- Register, login, and logout
- Browse available rooms with search
- View room details and availability by date
- Book available time slots (system prevents double-booking)
- Cancel own bookings (status changes from Booked → Canceled)
- View booking history (upcoming and past)

---

## Core Features

1. **User Authentication** – Register/login/logout with session-based auth
2. **Room Management** – Admin CRUD for rooms (name, location, capacity, description)
3. **Availability Viewer** – Select a date to see booked vs. available hourly slots
4. **Room Booking** – Book a custom time range; server-side conflict prevention
5. **Cancel Booking** – Users cancel their own; admins cancel any with logged reason
6. **My Bookings** – Filter by active/canceled; view full history
7. **Admin Dashboard** – Stats: total rooms, users, bookings; bar charts for room usage and weekly distribution

---

## Pages / Views

| #  | Page                       | Description                                     |
|----|----------------------------|-------------------------------------------------|
| 1  | Login / Register           | Authentication forms with role selection         |
| 2  | Room List                  | Grid of all rooms with search                    |
| 3  | Room Detail                | Availability calendar, time slots, booking form  |
| 4  | My Bookings                | User's reservations with cancel option           |
| 5  | Admin: Manage Rooms        | CRUD table for rooms                             |
| 6  | Admin: All Bookings        | Filterable list of every booking                 |
| 7  | Dashboard / Analytics      | Stat cards and bar charts                        |

---

## Data Tables

| Table         | Key Fields                                                              |
|---------------|-------------------------------------------------------------------------|
| **Users**     | id, username, email, password_hash, first_name, last_name, role, created_at |
| **Rooms**     | id, name, location, capacity, description, created_at                   |
| **Bookings**  | id, room_id, user_id, date, start_time, end_time, status, created_at   |
| **AdminActions** | id, admin_id, booking_id, action, note, created_at                  |

### Relationships
- One user → many bookings
- One room → many bookings
- Each booking belongs to one user and one room
- Admin actions link to one admin and one booking

---

## API Endpoints

### Authentication
| Method | Endpoint           | Description        |
|--------|--------------------|--------------------|
| POST   | `/api/register`    | Create account     |
| POST   | `/api/login`       | Login              |
| GET    | `/api/current-user`| Session check      |
| POST   | `/api/logout`      | Logout             |

### Rooms
| Method | Endpoint                          | Description              |
|--------|-----------------------------------|--------------------------|
| GET    | `/api/rooms`                      | List rooms (with search) |
| POST   | `/api/rooms`                      | Create room (admin)      |
| GET    | `/api/rooms/:id`                  | Room details             |
| PUT    | `/api/rooms/:id`                  | Update room (admin)      |
| DELETE | `/api/rooms/:id`                  | Delete room (admin)      |
| GET    | `/api/rooms/:id/availability`     | Booked slots for a date  |

### Bookings
| Method | Endpoint                      | Description              |
|--------|-------------------------------|--------------------------|
| GET    | `/api/bookings`               | User's bookings          |
| POST   | `/api/bookings`               | Create booking           |
| GET    | `/api/bookings/:id`           | Booking detail           |
| POST   | `/api/bookings/:id/cancel`    | Cancel a booking         |

### Admin
| Method | Endpoint                | Description              |
|--------|-------------------------|--------------------------|
| GET    | `/api/admin/bookings`   | All bookings (filtered)  |
| GET    | `/api/admin/stats`      | Dashboard statistics     |
| GET    | `/api/admin/actions`    | Admin action log         |

---

## Tech Stack

| Layer    | Technology                              |
|----------|-----------------------------------------|
| Backend  | Python, Flask, SQLAlchemy, Flask-Login   |
| Database | SQLite                                  |
| Frontend | HTML, CSS, Vanilla JavaScript           |
| Auth     | Session-based (Flask-Login + cookies)    |
| Server   | Waitress (production WSGI)              |

---

## Double-Booking Prevention

The system uses **server-side validation** before confirming any booking:

1. When a user submits a booking, the backend queries all existing `booked` entries for the same room and date.
2. It checks for time overlap: `new_start < existing_end AND new_end > existing_start`.
3. If any overlap exists, the booking is rejected with HTTP 409 and an error message.
4. The frontend also displays booked slots visually so users can choose open times.

---

## Troubleshooting

### Port in Use
```bash
lsof -ti:5001 | xargs kill -9
lsof -ti:8000 | xargs kill -9
```

### Reset Database
```bash
rm backend/roombooking.db
cd backend && python app.py
```

### CORS Errors
- Ensure backend is running on port 5001
- Frontend must be served via `python -m http.server 8000` (not opened as a file)

---

## License

Educational project for CSC 4370 at Georgia State University.
