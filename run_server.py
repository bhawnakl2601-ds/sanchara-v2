import sys
import os

# Make sure Python can find BOTH code folders that live next to this file:
#   backend/        (BMTC)
#   metro_backend/  (Metro)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app import app

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"\n=======================================================")
    print(f"  SANCHARA - BMTC + METRO  (one server, one port)")
    print(f"  Front page:      http://localhost:{port}/")
    print(f"  BMTC buses:      http://localhost:{port}/bmtc/")
    print(f"  Namma Metro:     http://localhost:{port}/metro/")
    print(f"  BMTC admin:      http://localhost:{port}/bmtc/admin")
    print(f"=======================================================\n")
    # threaded=True lets the server handle many requests at once (needed for the live metro notification stream)
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
