#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GeoJSONLファイルを経度範囲ごとに8分割する（メモリ効率化）
経度を8分割: 130.0-130.2, 130.2-130.4, ..., 130.8-131.0
"""

import json
import os

input_file = 'web_data/buildings_usage.geojsonl'
output_dir = 'web_data/buildings_by_region'

# 出力ディレクトリを作成
os.makedirs(output_dir, exist_ok=True)

# 経度範囲ごとのファイルハンドル（8分割）
regions = {}
lon_ranges = [
    ('lon_0', 130.0, 130.2),
    ('lon_1', 130.2, 130.4),
    ('lon_2', 130.4, 130.6),
    ('lon_3', 130.6, 130.8),
    ('lon_4', 130.8, 131.0),
    ('lon_5', 131.0, 131.2),
    ('lon_6', 131.2, 131.4),
    ('lon_7', 131.4, 131.6),
]

for region_id, _, _ in lon_ranges:
    regions[region_id] = open(os.path.join(output_dir, f'{region_id}.geojsonl'), 'w', encoding='utf-8')

counts = {region_id: 0 for region_id, _, _ in lon_ranges}

with open(input_file, 'r', encoding='utf-8') as f:
    for line in f:
        if line.strip():
            try:
                feature = json.loads(line)
                coords = feature['geometry']['coordinates']
                lon = coords[0]
                
                # 経度範囲で分類
                region_id = 'lon_7'  # デフォルト
                for rid, min_lon, max_lon in lon_ranges:
                    if min_lon <= lon < max_lon:
                        region_id = rid
                        break
                
                regions[region_id].write(json.dumps(feature, ensure_ascii=False) + '\n')
                counts[region_id] += 1
            except (json.JSONDecodeError, KeyError, IndexError):
                continue

# ファイルを閉じる
for f in regions.values():
    f.close()

total = sum(counts.values())
print(f"Total features: {total}")
for region_id, min_lon, max_lon in lon_ranges:
    count = counts[region_id]
    print(f"  {region_id} ({min_lon}-{max_lon}): {count}")
print(f"\nFiles written to {output_dir}")



