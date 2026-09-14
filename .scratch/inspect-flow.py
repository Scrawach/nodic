from pathlib import Path
text=Path('node_modules/@xyflow/react/dist/esm/index.js').read_text()
for token in ('onDoubleClick: props.', 'const onDoubleClickHandler', 'function handleNodeClick'):
    start=text.find(token)
    print(token, start, text[max(0,start-150):start+1200])
