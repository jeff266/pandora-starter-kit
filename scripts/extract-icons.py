#!/usr/bin/env python3
"""
Extract individual icons from the grid images.
Each grid is 4x4 = 16 icons total
"""

from PIL import Image
import os
import sys

def extract_icons(input_path, output_dir, icon_size):
    """Extract icons from a 4x4 grid image"""

    # Load the image
    img = Image.open(input_path)
    width, height = img.size

    # Calculate icon dimensions (4x4 grid)
    icon_width = width // 4
    icon_height = height // 4

    print(f"Image size: {width}x{height}")
    print(f"Icon size: {icon_width}x{icon_height}")

    # Icon names based on visual inspection of the pack
    icon_names = [
        # Row 1
        'wifi', 'lightbulb', 'globe', 'chart-growth',
        # Row 2
        'network', 'flow', 'filter', 'building',
        # Row 3
        'hub', 'trending', 'check-flow', 'refresh',
        # Row 4
        'target', 'brain', 'transfer', 'connections'
    ]

    # Extract each icon
    for idx, name in enumerate(icon_names):
        row = idx // 4
        col = idx % 4

        # Calculate crop box
        left = col * icon_width
        top = row * icon_height
        right = left + icon_width
        bottom = top + icon_height

        # Crop the icon
        icon = img.crop((left, top, right, bottom))

        # Save with appropriate name
        output_path = os.path.join(output_dir, f"{name}-{icon_size}.png")
        icon.save(output_path, 'PNG')
        print(f"Extracted: {name}-{icon_size}.png")

def main():
    # Icon pack files
    icon_packs = [
        ('/Users/jeffignacio/Downloads/icon_pack_32x32.png', 32),
        ('/Users/jeffignacio/Downloads/icon_pack_64x64.png', 64),
        ('/Users/jeffignacio/Downloads/icon_pack_128x128.png', 128),
    ]

    # Output directory
    output_dir = '/Users/jeffignacio/pandora-starter-kit/client/public/icons'
    os.makedirs(output_dir, exist_ok=True)

    # Extract from each size
    for pack_path, size in icon_packs:
        if os.path.exists(pack_path):
            print(f"\nProcessing {size}x{size} pack...")
            extract_icons(pack_path, output_dir, size)
        else:
            print(f"Warning: {pack_path} not found")

    print(f"\nDone! Icons extracted to {output_dir}")

if __name__ == '__main__':
    main()
