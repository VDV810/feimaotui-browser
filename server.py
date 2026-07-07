#!/usr/bin/env python3
import http.server, json, subprocess, os, sys

PORT = 8765
PROJECT_DIR = '/workspace/electron-browser'

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PROJECT_DIR, **kwargs)

    def do_POST(self):
        if self.path == '/api/push':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            remote_url = body.get('remoteUrl', '')
            username = body.get('username', '')
            repo = body.get('repo', '')

            try:
                # Set remote and push
                os.chdir(PROJECT_DIR)
                
                # Check if remote exists
                r = subprocess.run(['git', 'remote', 'get-url', 'origin'], capture_output=True, text=True)
                if r.returncode == 0:
                    subprocess.run(['git', 'remote', 'set-url', 'origin', remote_url], check=True)
                else:
                    subprocess.run(['git', 'remote', 'add', 'origin', remote_url], check=True)

                # Stage all changes
                subprocess.run(['git', 'add', '-A'], check=True)

                # Commit
                r = subprocess.run(['git', 'commit', '-m', 'feat: v1.2.12 - 下载修复、书签溢出菜单、嗅探去重等多项改进'], capture_output=True, text=True)
                commit_output = r.stdout + r.stderr

                # Push
                r = subprocess.run(['git', 'push', '-u', 'origin', 'master'], capture_output=True, text=True, timeout=120)
                push_output = r.stdout + r.stderr

                if r.returncode != 0:
                    # Check if already up-to-date
                    if 'Everything up-to-date' in push_output:
                        self._json_resp(True, {'ok': True, 'msg': '代码已是最新'})
                    else:
                        self._json_resp(False, {'ok': False, 'error': push_output})
                else:
                    self._json_resp(True, {'ok': True, 'msg': push_output[:200]})

            except Exception as e:
                self._json_resp(False, {'ok': False, 'error': str(e)})
        else:
            self._json_resp(False, {'ok': False, 'error': 'unknown path'})

    def _json_resp(self, success, data):
        self.send_response(200 if success else 500)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

print(f'Server starting on http://localhost:{PORT}')
http.server.HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()