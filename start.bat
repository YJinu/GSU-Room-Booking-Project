@echo off
echo =========================================
echo   GSU Room Booking - Starting...
echo =========================================

echo [1/3] Installing Python dependencies...
pip install -r requirements.txt -q

echo [2/3] Starting backend server...
start "Backend" cmd /c "cd backend && python app.py"

timeout /t 2 /nobreak > nul

echo [3/3] Starting frontend server...
start "Frontend" cmd /c "cd frontend && python -m http.server 8000"

echo.
echo =========================================
echo   GSU Room Booking is running!
echo =========================================
echo   Frontend: http://localhost:8000
echo   Backend:  http://localhost:5001
echo.
echo   Sample Accounts:
echo     Admin: admin / admin123
echo     User:  jdoe / password123
echo.
echo   Close both terminal windows to stop.
echo =========================================

start http://localhost:8000
