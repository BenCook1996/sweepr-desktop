import os
import xml.etree.ElementTree as ET
import re

xml_path = 'app/src/main/res/values/strings.xml'
tree = ET.parse(xml_path)
root = tree.getroot()

strings = {}
for child in root:
    if child.tag == 'string':
        name = child.attrib.get('name')
        text = child.text
        if text:
            text = text.replace('\\"', '"').replace("\\'", "'").replace('\\n', '\n')
            strings[text] = name
    elif child.tag == 'plurals':
        name = child.attrib.get('name')
        for item in child:
            q = item.attrib.get('quantity')
            text = item.text
            if text:
                text = text.replace('\\"', '"').replace("\\'", "'").replace('\\n', '\n')
                strings[text] = f"plurals:{name}:{q}"

print(f"Loaded {len(strings)} string resources")

kt_dir = 'app/src/main/java/com/sweepr/app'
for root_dir, dirs, files in os.walk(kt_dir):
    for f in files:
        if f.endswith('.kt'):
            path = os.path.join(root_dir, f)
            with open(path, 'r', encoding='utf-8') as file:
                content = file.read()
            
            # Simple heuristic: find strings
            matches = re.finditer(r'"(.*?)"', content)
            found = []
            for m in matches:
                val = m.group(1)
                # Unescape for comparison
                val_unesc = val.replace('\\"', '"').replace("\\'", "'")
                if val_unesc in strings:
                    found.append((val, strings[val_unesc]))
            
            if found:
                print(f"\n--- {f} ---")
                for val, res in found:
                    print(f"Found '{val}' -> {res}")
