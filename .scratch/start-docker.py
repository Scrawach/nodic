import subprocess
startup = subprocess.STARTUPINFO()
startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
startup.wShowWindow = 0
subprocess.Popen(['C:/Program Files/Docker/Docker/Docker Desktop.exe'], startupinfo=startup, creationflags=subprocess.CREATE_NO_WINDOW)
print('Docker Desktop launch requested')
