@echo off
echo Serving on http://localhost:8080
echo   Upload page:     http://localhost:8080/frontend/
echo   Admin dashboard: http://localhost:8080/frontend/admin/
python -m http.server 8080
