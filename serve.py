#!/usr/bin/env python3
import http.server, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 7779

class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        pass

print(f"Slots plugin running: http://localhost:{PORT}")
http.server.HTTPServer(("", PORT), CORSHandler).serve_forever()
