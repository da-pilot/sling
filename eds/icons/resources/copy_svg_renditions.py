import os
import shutil
import urllib.parse

SRC_ROOT = '/Users/kiranm/Downloads/sling-icons'
DST_ROOT = '/Users/kiranm/Downloads/sling-svgs'

for dirpath, dirnames, filenames in os.walk(SRC_ROOT):
    # Check if current folder ends with .svg
    if dirpath.endswith('.svg'):
        svg_folder = os.path.basename(dirpath)
        # Check for _jcr_content/renditions/original
        renditions_path = os.path.join(dirpath, '_jcr_content', 'renditions')
        original_file = os.path.join(renditions_path, 'original')
        if os.path.isfile(original_file):
            # Compute relative path up to the parent of the .svg folder
            rel_path = os.path.relpath(os.path.dirname(dirpath), SRC_ROOT)
            # Decode any percent-encoded path components
            rel_path_decoded = urllib.parse.unquote(urllib.parse.unquote(rel_path))
            svg_filename = urllib.parse.unquote(urllib.parse.unquote(svg_folder))
            # Destination path: /Users/kiranm/Downloads/sling-svgs/<rel_path>/<svg_folder>.svg
            dst_dir = os.path.join(DST_ROOT, rel_path_decoded)
            os.makedirs(dst_dir, exist_ok=True)
            dst_file = os.path.join(dst_dir, svg_filename)
            shutil.copy2(original_file, dst_file)
            print(f'Copied: {original_file} -> {dst_file}') 