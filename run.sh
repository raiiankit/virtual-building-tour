#!/usr/bin/env bash
# One-command local start: venv -> install -> seed demo user -> run server.
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi
source .venv/bin/activate

echo "Installing requirements..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo "Seeding demo user (demo@vbt.local / demo1234)..."
python -m backend.seed || true

echo ""
echo "Starting server on http://localhost:8000  (Ctrl+C to stop)"
echo "Open http://localhost:8000  in your browser."
exec uvicorn backend.main:app --reload --port 8000
