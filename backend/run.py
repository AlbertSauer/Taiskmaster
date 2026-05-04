#!/usr/bin/env python
"""
Entry point for the Flask application.
Run with: python run.py
"""

from app.main import app

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8000)
