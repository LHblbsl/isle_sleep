# -*- coding: utf-8 -*-
""" Isle Sleep launcher. Double-click to run. """
import os, http.server, socketserver, socket, webbrowser, threading
from urllib.parse import quote

HOME_NAME = "\u4e3b\u9875\u9762"  # 主页面
BASE = os.path.dirname(os.path.abspath(__file__))

def find_port(start=8000):
    for p in range(start, start + 200):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("", p))
                return p
        except OSError:
            continue
    return start

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()
    def log_message(self, fmt, *args):
        pass

class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    os.chdir(BASE)
    home_path = os.path.join(BASE, HOME_NAME)
    if not os.path.isdir(home_path):
        print("[ERROR] Missing folder: %s" % HOME_NAME)
        print("        This package is incomplete.")
        input("Press Enter to exit...")
        raise SystemExit(1)
    port = find_port()
    rel = quote(HOME_NAME + "/index.html")
    url = "http://localhost:%d/%s" % (port, rel)
    print("=" * 54)
    print("  Isle Sleep")
    print("  URL: %s" % url)
    print("  Press Ctrl+C to stop")
    print("=" * 54)
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    with ThreadedServer(("", port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped")