import zipfile,json
with zipfile.ZipFile('test-results/collaboration-two-browser--ad755-nd-undo-only-their-own-text/trace.zip') as z:
    for name in z.namelist():
        if name.endswith('.trace'):
            for line in z.read(name).decode().splitlines():
                item=json.loads(line)
                if item.get('type') in ('event','console') and ('error' in str(item).lower()):
                    print(json.dumps(item,ensure_ascii=True)[:5000])
