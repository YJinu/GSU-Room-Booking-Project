#!/bin/bash
echo "========================================="
echo "  GSU Room Booking - Starting..."
echo "========================================="

# Install dependencies
echo "[1/3] Installing Python dependencies..."
pip install -r requirements.txt --break-system-packages -q 2>/dev/null || pip install -r requirements.txt -q

# Start backend
echo "[2/3] Starting backend server..."
cd backend
python app.py &
BACKEND_PID=$!
cd ..

# Wait for backend
sleep 2

# Start frontend
echo "[3/3] Starting frontend server..."
cd frontend
python -m http.server 8000 &
FRONTEND_PID=$!
cd ..

echo ""
echo "========================================="
echo "  GSU Room Booking is running!"
echo "========================================="
echo "  Frontend: http://localhost:8000"
echo "  Backend:  http://localhost:5001"
echo ""
echo "  Sample Accounts:"
echo "    Admin: admin / admin123"
echo "    User:  jdoe / password123"
echo ""
echo "  Press Ctrl+C to stop."
echo "========================================="

# Handle shutdown
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
