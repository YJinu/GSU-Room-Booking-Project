// API Configuration
const API_HOST = window.location.hostname || 'localhost';
const API_PROTOCOL = window.location.protocol === 'file:' ? 'http:' : window.location.protocol;
const API_URL = `${API_PROTOCOL}//${API_HOST}:5001/api`;

// Global State
let currentUser = null;
let rooms = [];
let currentRoomId = null;

const USER_CACHE_KEY = 'roombooking_user';

function cacheUser(user) {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
}
function getCachedUser() {
    try { return JSON.parse(localStorage.getItem(USER_CACHE_KEY)); } catch (_) { return null; }
}
function clearCachedUser() {
    localStorage.removeItem(USER_CACHE_KEY);
}

// ========================
// INIT
// ========================
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    checkAuthStatus();
});

function initializeEventListeners() {
    const bindById = (id, eventName, handler) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener(eventName, handler);
    };

    // Auth
    bindById('login-form', 'submit', handleLogin);
    bindById('register-form', 'submit', handleRegister);
    bindById('show-register', 'click', (e) => { e.preventDefault(); showPage('register-page'); });
    bindById('show-login', 'click', (e) => { e.preventDefault(); showPage('login-page'); });
    bindById('logout-btn', 'click', handleLogout);

    // Nav
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = e.target.dataset.view;
            if (view) showView(view);
        });
    });

    // Room search
    bindById('room-search', 'input', debounce(() => loadRooms(), 300));

    // Back button — use browser history so it goes to wherever you came from
    bindById('back-to-rooms', 'click', () => history.back());

    // Booking filters
    bindById('booking-status-filter', 'change', () => loadMyBookings());

    // Admin filters
    bindById('admin-booking-status-filter', 'change', () => loadAdminBookings());
    bindById('admin-booking-room-filter', 'change', () => loadAdminBookings());

    // Admin add room
    bindById('add-room-btn', 'click', () => showAddRoomModal());
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ========================
// PAGE / VIEW NAVIGATION + HASH ROUTING
// ========================
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(pageId);
    if (page) page.classList.add('active');
}

// Internal view switcher — does NOT touch the hash (prevents infinite loops)
function _activateView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(viewName + '-view');
    if (view) view.classList.add('active');

    // Update nav highlight
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector(`.nav-link[data-view="${viewName}"]`)?.classList.add('active');

    // Load data for view
    switch (viewName) {
        case 'rooms': loadRooms(); break;
        case 'my-bookings': loadMyBookings(); break;
        case 'admin-rooms': loadAdminRooms(); break;
        case 'admin-bookings': loadAdminBookings(); break;
        case 'admin-users': loadAdminUsers(); break;
        case 'dashboard': loadDashboard(); break;
    }
}

// Public view switcher — pushes a new hash entry so back/forward works
function showView(viewName) {
    const newHash = '#' + viewName;
    if (window.location.hash !== newHash) {
        window.location.hash = newHash;  // triggers hashchange → _onHashChange
    } else {
        _activateView(viewName);  // same hash, just refresh the view
    }
}

// Listen for back/forward button presses and hash changes
window.addEventListener('hashchange', _onHashChange);

function _onHashChange() {
    if (!currentUser) return;  // not logged in, ignore hash changes
    const hash = window.location.hash.replace('#', '');
    if (!hash) {
        _activateView('rooms');
        return;
    }
    // Handle room detail routes like #room/5
    if (hash.startsWith('room/')) {
        const roomId = parseInt(hash.split('/')[1]);
        if (roomId) {
            _activateView('room-detail');
            openRoomDetail(roomId, false);  // false = don't push hash again
            return;
        }
    }
    _activateView(hash);
}

// Read the current hash on app entry (so refreshing stays on the right view)
function _restoreFromHash() {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
        _onHashChange();
    } else {
        _activateView('rooms');
    }
}

// ========================
// AUTH
// ========================
async function checkAuthStatus() {
    try {
        const res = await fetch(`${API_URL}/current-user`, { credentials: 'include' });
        if (res.ok) {
            currentUser = await res.json();
            cacheUser(currentUser);
            enterApp();
        } else {
            const cached = getCachedUser();
            if (cached) {
                currentUser = cached;
                enterApp();
            } else {
                showPage('login-page');
            }
        }
    } catch (err) {
        const cached = getCachedUser();
        if (cached) {
            currentUser = cached;
            enterApp();
        } else {
            showPage('login-page');
        }
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            currentUser = data.user;
            cacheUser(currentUser);
            enterApp();
        } else {
            showAlert('login-form', data.error || 'Login failed', 'error');
        }
    } catch (err) {
        showAlert('login-form', 'Connection error. Is the backend running?', 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const payload = {
        username: document.getElementById('username').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
        first_name: document.getElementById('first-name').value,
        last_name: document.getElementById('last-name').value
    };

    try {
        const res = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            showAlert('register-form', 'Registration successful! Please login.', 'success');
            setTimeout(() => showPage('login-page'), 1500);
        } else {
            showAlert('register-form', data.error || 'Registration failed', 'error');
        }
    } catch (err) {
        showAlert('register-form', 'Connection error.', 'error');
    }
}

async function handleLogout() {
    try {
        await fetch(`${API_URL}/logout`, { method: 'POST', credentials: 'include' });
    } catch (_) {}
    currentUser = null;
    clearCachedUser();
    document.body.classList.remove('is-admin');
    history.replaceState(null, '', window.location.pathname);  // clear the hash
    showPage('login-page');
}

function enterApp() {
    showPage('main-app');
    document.getElementById('user-display-name').textContent = `${currentUser.first_name} ${currentUser.last_name}`;
    const badge = document.getElementById('user-role-badge');
    badge.textContent = currentUser.role;
    badge.className = 'role-badge ' + currentUser.role;

    if (currentUser.role === 'admin') {
        document.body.classList.add('is-admin');
    } else {
        document.body.classList.remove('is-admin');
    }

    _restoreFromHash();  // go to whatever view the URL hash says, or default to rooms
}

// ========================
// ROOM LIST
// ========================
async function loadRooms() {
    const keyword = document.getElementById('room-search')?.value || '';
    try {
        const res = await fetch(`${API_URL}/rooms?keyword=${encodeURIComponent(keyword)}`, { credentials: 'include' });
        rooms = await res.json();
        renderRooms();
    } catch (err) {
        document.getElementById('rooms-grid').innerHTML = '<div class="empty-state"><h3>Connection Error</h3><p>Could not load rooms.</p></div>';
    }
}

function renderRooms() {
    const grid = document.getElementById('rooms-grid');
    if (rooms.length === 0) {
        grid.innerHTML = '<div class="empty-state"><h3>No Rooms Found</h3><p>No rooms match your search.</p></div>';
        return;
    }
    grid.innerHTML = rooms.map(r => `
        <div class="room-card" onclick="openRoomDetail(${r.id})">
            <h3>${escHtml(r.name)}</h3>
            <div class="room-meta">
                <span>📍 ${escHtml(r.location)}</span>
                <span>👥 Capacity: ${r.capacity}</span>
            </div>
            <p class="room-desc">${escHtml(r.description || 'No description.')}</p>
        </div>
    `).join('');
}

// ========================
// ROOM DETAIL + BOOKING
// ========================
async function openRoomDetail(roomId, pushHash = true) {
    currentRoomId = roomId;

    // Activate the view div without touching the hash
    _activateView('room-detail');

    // Push hash so back button works (only when user clicked, not when restoring)
    if (pushHash) {
        const newHash = '#room/' + roomId;
        if (window.location.hash !== newHash) {
            window.location.hash = newHash;
        }
    }

    try {
        const res = await fetch(`${API_URL}/rooms/${roomId}`, { credentials: 'include' });
        const room = await res.json();
        renderRoomDetail(room);
    } catch (err) {
        document.getElementById('room-detail-content').innerHTML = '<div class="alert alert-error">Failed to load room details.</div>';
    }
}

function renderRoomDetail(room) {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('room-detail-content').innerHTML = `
        <div class="room-detail-header">
            <h2>${escHtml(room.name)}</h2>
            <div class="meta-row">
                <span>📍 ${escHtml(room.location)}</span>
                <span>👥 Capacity: ${room.capacity}</span>
            </div>
            <p>${escHtml(room.description || '')}</p>
        </div>
        <div class="availability-section">
            <h3>Check Availability & Book</h3>
            <div class="date-picker-row">
                <label>Select Date:</label>
                <input type="date" id="avail-date" value="${today}" min="${today}">
                <button class="btn btn-outline btn-sm" onclick="loadAvailability(${room.id})">Check</button>
            </div>
            <div id="time-slots-area"></div>
            <div class="booking-form" id="booking-form-area">
                <h4>Book a Time Slot</h4>
                <div class="time-inputs">
                    <label>Start:</label>
                    <input type="time" id="book-start" step="1800" value="09:00">
                    <span>to</span>
                    <label>End:</label>
                    <input type="time" id="book-end" step="1800" value="10:00">
                </div>
                <div id="booking-alert"></div>
                <button class="btn btn-success" onclick="submitBooking(${room.id})">Book Room</button>
            </div>
        </div>
    `;
    loadAvailability(room.id);
}

async function loadAvailability(roomId) {
    const date = document.getElementById('avail-date')?.value;
    if (!date) return;

    try {
        const res = await fetch(`${API_URL}/rooms/${roomId}/availability?date=${date}`, { credentials: 'include' });
        const data = await res.json();
        renderTimeSlots(data.booked_slots);
    } catch (err) {
        document.getElementById('time-slots-area').innerHTML = '<div class="alert alert-error">Failed to load availability.</div>';
    }
}

function renderTimeSlots(bookedSlots) {
    const area = document.getElementById('time-slots-area');
    // Generate 1-hour slots from 08:00 to 20:00
    const hours = [];
    for (let h = 8; h < 20; h++) {
        const start = `${String(h).padStart(2, '0')}:00`;
        const end = `${String(h + 1).padStart(2, '0')}:00`;
        const isBooked = bookedSlots.some(b => start < b.end_time && end > b.start_time);
        hours.push({ start, end, isBooked });
    }

    if (bookedSlots.length === 0) {
        area.innerHTML = '<div class="alert alert-success">All time slots are available for this date!</div>';
    } else {
        area.innerHTML = `
            <div class="time-slots-grid">
                ${hours.map(s => `
                    <div class="time-slot ${s.isBooked ? 'booked' : 'available'}"
                         ${!s.isBooked ? `onclick="selectSlot('${s.start}','${s.end}')"` : ''}>
                        ${s.start} - ${s.end}
                        <br><small>${s.isBooked ? 'Booked' : 'Available'}</small>
                    </div>
                `).join('')}
            </div>
        `;
    }
}

function selectSlot(start, end) {
    document.getElementById('book-start').value = start;
    document.getElementById('book-end').value = end;

    // Highlight selected
    document.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
}

async function submitBooking(roomId) {
    const date = document.getElementById('avail-date').value;
    const startTime = document.getElementById('book-start').value;
    const endTime = document.getElementById('book-end').value;

    if (!date || !startTime || !endTime) {
        showInlineAlert('booking-alert', 'Please select a date and time.', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                room_id: roomId,
                date: date,
                start_time: startTime,
                end_time: endTime
            })
        });
        const data = await res.json();
        if (res.ok) {
            showInlineAlert('booking-alert', 'Room booked successfully!', 'success');
            loadAvailability(roomId);
        } else {
            showInlineAlert('booking-alert', data.error || 'Booking failed.', 'error');
        }
    } catch (err) {
        showInlineAlert('booking-alert', 'Connection error.', 'error');
    }
}

// ========================
// MY BOOKINGS
// ========================
async function loadMyBookings() {
    const status = document.getElementById('booking-status-filter')?.value || '';
    try {
        const res = await fetch(`${API_URL}/bookings?status=${status}`, { credentials: 'include' });
        const bookings = await res.json();
        renderMyBookings(bookings);
    } catch (err) {
        document.getElementById('my-bookings-list').innerHTML = '<div class="empty-state"><h3>Error</h3><p>Could not load bookings.</p></div>';
    }
}

function renderMyBookings(bookings) {
    const list = document.getElementById('my-bookings-list');
    if (bookings.length === 0) {
        list.innerHTML = '<div class="empty-state"><h3>No Bookings</h3><p>You haven\'t made any bookings yet.</p></div>';
        return;
    }

    list.innerHTML = bookings.map(b => `
        <div class="booking-card">
            <div class="booking-info">
                <h4>${escHtml(b.room_name)}</h4>
                <div class="booking-meta">
                    <span>📍 ${escHtml(b.room_location)}</span>
                    <span>📅 ${b.date}</span>
                    <span>🕐 ${b.start_time} - ${b.end_time}</span>
                </div>
            </div>
            <div class="booking-actions">
                <span class="status-badge ${b.status}">${b.status}</span>
                ${b.status === 'booked' ? `<button class="btn btn-danger btn-xs" onclick="cancelBooking(${b.id})">Cancel</button>` : ''}
            </div>
        </div>
    `).join('');
}

async function cancelBooking(bookingId) {
    if (!confirm('Are you sure you want to cancel this booking?')) return;

    try {
        const res = await fetch(`${API_URL}/bookings/${bookingId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        if (res.ok) {
            loadMyBookings();
        } else {
            const data = await res.json();
            alert(data.error || 'Failed to cancel.');
        }
    } catch (err) {
        alert('Connection error.');
    }
}

// ========================
// ADMIN: MANAGE ROOMS
// ========================
async function loadAdminRooms() {
    try {
        const res = await fetch(`${API_URL}/rooms`, { credentials: 'include' });
        const roomsList = await res.json();
        renderAdminRooms(roomsList);
    } catch (err) {
        document.getElementById('admin-rooms-list').innerHTML = '<div class="alert alert-error">Failed to load rooms.</div>';
    }
}

function renderAdminRooms(roomsList) {
    const wrap = document.getElementById('admin-rooms-list');
    if (roomsList.length === 0) {
        wrap.innerHTML = '<div class="empty-state"><h3>No Rooms</h3><p>Create your first room.</p></div>';
        return;
    }

    wrap.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Location</th>
                    <th>Capacity</th>
                    <th>Description</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${roomsList.map(r => `
                    <tr>
                        <td><strong>${escHtml(r.name)}</strong></td>
                        <td>${escHtml(r.location)}</td>
                        <td>${r.capacity}</td>
                        <td>${escHtml((r.description || '').slice(0, 60))}${(r.description || '').length > 60 ? '...' : ''}</td>
                        <td>
                            <button class="btn btn-outline btn-xs" onclick="showEditRoomModal(${r.id})">Edit</button>
                            <button class="btn btn-danger btn-xs" onclick="deleteRoom(${r.id})">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function showAddRoomModal() {
    showModal(`
        <h3>Add New Room</h3>
        <div class="form-group">
            <label>Room Name</label>
            <input type="text" id="modal-room-name" placeholder="e.g. Conference Room A">
        </div>
        <div class="form-group">
            <label>Location</label>
            <input type="text" id="modal-room-location" placeholder="e.g. Aderhold Hall, Room 101">
        </div>
        <div class="form-group">
            <label>Capacity</label>
            <input type="number" id="modal-room-capacity" min="1" value="10">
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea id="modal-room-desc" placeholder="Room features and equipment..."></textarea>
        </div>
        <div id="modal-alert"></div>
        <div class="modal-actions">
            <button class="btn btn-outline" onclick="hideModal()">Cancel</button>
            <button class="btn btn-primary" style="width:auto" onclick="submitAddRoom()">Create Room</button>
        </div>
    `);
}

async function submitAddRoom() {
    const payload = {
        name: document.getElementById('modal-room-name').value,
        location: document.getElementById('modal-room-location').value,
        capacity: parseInt(document.getElementById('modal-room-capacity').value),
        description: document.getElementById('modal-room-desc').value
    };

    if (!payload.name || !payload.location || !payload.capacity) {
        showInlineAlert('modal-alert', 'All fields are required.', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            hideModal();
            loadAdminRooms();
        } else {
            showInlineAlert('modal-alert', data.error || 'Failed to create room.', 'error');
        }
    } catch (err) {
        showInlineAlert('modal-alert', 'Connection error.', 'error');
    }
}

async function showEditRoomModal(roomId) {
    try {
        const res = await fetch(`${API_URL}/rooms/${roomId}`, { credentials: 'include' });
        const room = await res.json();

        showModal(`
            <h3>Edit Room</h3>
            <div class="form-group">
                <label>Room Name</label>
                <input type="text" id="modal-room-name" value="${escAttr(room.name)}">
            </div>
            <div class="form-group">
                <label>Location</label>
                <input type="text" id="modal-room-location" value="${escAttr(room.location)}">
            </div>
            <div class="form-group">
                <label>Capacity</label>
                <input type="number" id="modal-room-capacity" min="1" value="${room.capacity}">
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea id="modal-room-desc">${escHtml(room.description || '')}</textarea>
            </div>
            <div id="modal-alert"></div>
            <div class="modal-actions">
                <button class="btn btn-outline" onclick="hideModal()">Cancel</button>
                <button class="btn btn-primary" style="width:auto" onclick="submitEditRoom(${roomId})">Save Changes</button>
            </div>
        `);
    } catch (err) {
        alert('Failed to load room details.');
    }
}

async function submitEditRoom(roomId) {
    const payload = {
        name: document.getElementById('modal-room-name').value,
        location: document.getElementById('modal-room-location').value,
        capacity: parseInt(document.getElementById('modal-room-capacity').value),
        description: document.getElementById('modal-room-desc').value
    };

    try {
        const res = await fetch(`${API_URL}/rooms/${roomId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            hideModal();
            loadAdminRooms();
        } else {
            const data = await res.json();
            showInlineAlert('modal-alert', data.error || 'Update failed.', 'error');
        }
    } catch (err) {
        showInlineAlert('modal-alert', 'Connection error.', 'error');
    }
}

async function deleteRoom(roomId) {
    if (!confirm('Delete this room? All associated bookings will also be deleted.')) return;

    try {
        const res = await fetch(`${API_URL}/rooms/${roomId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (res.ok) {
            loadAdminRooms();
        } else {
            const data = await res.json();
            alert(data.error || 'Delete failed.');
        }
    } catch (err) {
        alert('Connection error.');
    }
}

// ========================
// ADMIN: ALL BOOKINGS
// ========================
async function loadAdminBookings() {
    const status = document.getElementById('admin-booking-status-filter')?.value || '';
    const roomId = document.getElementById('admin-booking-room-filter')?.value || '';

    // Populate room filter dropdown
    try {
        const roomsRes = await fetch(`${API_URL}/rooms`, { credentials: 'include' });
        const allRooms = await roomsRes.json();
        const roomSelect = document.getElementById('admin-booking-room-filter');
        const currentVal = roomSelect.value;
        roomSelect.innerHTML = '<option value="">All Rooms</option>' +
            allRooms.map(r => `<option value="${r.id}" ${r.id == currentVal ? 'selected' : ''}>${escHtml(r.name)}</option>`).join('');
    } catch (_) {}

    try {
        let url = `${API_URL}/admin/bookings?`;
        if (status) url += `status=${status}&`;
        if (roomId) url += `room_id=${roomId}&`;

        const res = await fetch(url, { credentials: 'include' });
        const bookings = await res.json();
        renderAdminBookings(bookings);
    } catch (err) {
        document.getElementById('admin-bookings-list').innerHTML = '<div class="alert alert-error">Failed to load bookings.</div>';
    }
}

function renderAdminBookings(bookings) {
    const wrap = document.getElementById('admin-bookings-list');
    if (bookings.length === 0) {
        wrap.innerHTML = '<div class="empty-state"><h3>No Bookings</h3><p>No bookings match your filters.</p></div>';
        return;
    }

    wrap.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Room</th>
                    <th>User</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${bookings.map(b => `
                    <tr>
                        <td>#${b.id}</td>
                        <td>${escHtml(b.room_name)}</td>
                        <td>${escHtml(b.user_name)}</td>
                        <td>${b.date}</td>
                        <td>${b.start_time} - ${b.end_time}</td>
                        <td><span class="status-badge ${b.status}">${b.status}</span></td>
                        <td>
                            ${b.status === 'booked' ? `<button class="btn btn-danger btn-xs" onclick="adminCancelBooking(${b.id})">Cancel</button>` : ''}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

async function adminCancelBooking(bookingId) {
    const note = prompt('Reason for canceling (optional):') || '';
    try {
        const res = await fetch(`${API_URL}/bookings/${bookingId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ note })
        });
        if (res.ok) {
            loadAdminBookings();
        } else {
            const data = await res.json();
            alert(data.error || 'Cancel failed.');
        }
    } catch (err) {
        alert('Connection error.');
    }
}

// ========================
// ADMIN: MANAGE USERS
// ========================
async function loadAdminUsers() {
    try {
        const res = await fetch(`${API_URL}/admin/users`, { credentials: 'include' });
        const users = await res.json();
        if (!res.ok) {
            throw new Error(users.error || 'Failed to load users.');
        }
        renderAdminUsers(users);
    } catch (err) {
        document.getElementById('admin-users-list').innerHTML = '<div class="alert alert-error">Failed to load users.</div>';
    }
}

function renderAdminUsers(users) {
    const wrap = document.getElementById('admin-users-list');
    if (!users.length) {
        wrap.innerHTML = '<div class="empty-state"><h3>No Users</h3><p>No registered users found.</p></div>';
        return;
    }

    wrap.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Username</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${users.map(u => `
                    <tr>
                        <td><strong>${escHtml(u.full_name)}</strong></td>
                        <td>${escHtml(u.username)}</td>
                        <td>${escHtml(u.email)}</td>
                        <td><span class="status-badge ${u.role === 'admin' ? 'booked' : 'canceled'}">${escHtml(u.role)}</span></td>
                        <td>${formatDateTime(u.created_at)}</td>
                        <td>
                            ${u.role === 'admin'
                                ? '<span style="color: var(--text-light);">Already admin</span>'
                                : `<button class="btn btn-primary btn-xs" onclick="promoteUserToAdmin(${u.id}, '${escAttr(u.full_name)}')">Promote to Admin</button>`}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

async function promoteUserToAdmin(userId, fullName) {
    if (!confirm(`Promote ${fullName} to admin? This will give them room management, booking management, and dashboard access.`)) return;

    try {
        const res = await fetch(`${API_URL}/admin/users/${userId}/promote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        const data = await res.json();
        if (res.ok) {
            alert(data.message || 'User promoted successfully.');
            loadAdminUsers();
        } else {
            alert(data.error || 'Failed to promote user.');
        }
    } catch (err) {
        alert('Connection error.');
    }
}

// ========================
// DASHBOARD / ANALYTICS
// ========================
async function loadDashboard() {
    try {
        const res = await fetch(`${API_URL}/admin/stats`, { credentials: 'include' });
        const stats = await res.json();
        renderDashboard(stats);
    } catch (err) {
        document.getElementById('dashboard-content').innerHTML = '<div class="alert alert-error">Failed to load statistics.</div>';
    }
}

function renderDashboard(stats) {
    const container = document.getElementById('dashboard-content');

    // Stat cards
    const cardsHtml = `
        <div class="dashboard-grid">
            <div class="stat-card">
                <div class="stat-label">Total Rooms</div>
                <div class="stat-value">${stats.total_rooms}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Registered Users</div>
                <div class="stat-value">${stats.total_users}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Active Bookings</div>
                <div class="stat-value">${stats.total_bookings}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Canceled</div>
                <div class="stat-value">${stats.total_canceled}</div>
                <div class="stat-sub">Total canceled bookings</div>
            </div>
        </div>
    `;

    // Most popular room
    const popularHtml = stats.most_popular_room ? `
        <div class="chart-section">
            <h3>Most Popular Room</h3>
            <p style="font-size:18px;font-weight:600;color:var(--primary-color);">${escHtml(stats.most_popular_room)}</p>
        </div>
    ` : '';

    // Room bookings bar chart
    const maxCount = Math.max(...stats.room_stats.map(r => r.booking_count), 1);
    const roomChartHtml = stats.room_stats.length > 0 ? `
        <div class="chart-section">
            <h3>Bookings per Room</h3>
            <div class="bar-chart">
                ${stats.room_stats.map(r => `
                    <div class="bar-row">
                        <div class="bar-label">${escHtml(r.room_name)}</div>
                        <div class="bar-track">
                            <div class="bar-fill" style="width: ${Math.max((r.booking_count / maxCount) * 100, 5)}%">
                                ${r.booking_count}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    ` : '';

    // Weekly distribution
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const maxDay = Math.max(...days.map(d => stats.weekly_distribution[d] || 0), 1);
    const weeklyHtml = `
        <div class="chart-section">
            <h3>Bookings by Day of Week (Last 30 Days)</h3>
            <div class="bar-chart">
                ${days.map(d => {
                    const count = stats.weekly_distribution[d] || 0;
                    return `
                        <div class="bar-row">
                            <div class="bar-label">${d}</div>
                            <div class="bar-track">
                                <div class="bar-fill" style="width: ${Math.max((count / maxDay) * 100, 3)}%">
                                    ${count}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    container.innerHTML = cardsHtml + popularHtml + roomChartHtml + weeklyHtml;
}

// ========================
// MODAL HELPERS
// ========================
function showModal(html) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function hideModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') hideModal();
});

// ========================
// ALERT HELPERS
// ========================
function showAlert(formId, message, type) {
    const form = document.getElementById(formId);
    if (!form) return;
    // Remove existing
    form.querySelectorAll('.alert').forEach(a => a.remove());
    const div = document.createElement('div');
    div.className = `alert alert-${type}`;
    div.textContent = message;
    form.prepend(div);
    setTimeout(() => div.remove(), 5000);
}

function showInlineAlert(containerId, message, type) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `<div class="alert alert-${type}">${escHtml(message)}</div>`;
    setTimeout(() => { if (el) el.innerHTML = ''; }, 5000);
}

// ========================
// UTILS
// ========================
function formatDateTime(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleString();
}

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

function escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
