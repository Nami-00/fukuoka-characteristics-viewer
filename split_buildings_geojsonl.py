#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GeoJSONLファイルを緯度範囲ごとに分割する（メモリ効率化）
"""

import json
import os

input_file = 'web_data/buildings_usage.geojsonl'
output_dir = 'web_data/buildings_by_region'

# 出力ディレクトリを作成
os.makedirs(output_dir, exist_ok=True)

# 緯度範囲ごとのファイルハンドル
regions = {
    'south': open(os.path.join(output_dir, 'south.geojsonl'), 'w', encoding='utf-8'),  # 33.4以下
    'center': open(os.path.join(output_dir, 'center.geojsonl'), 'w', encoding='utf-8'),  # 33.4-33.6
    'north': open(os.path.join(output_dir, 'north.geojsonl'), 'w', encoding='utf-8'),  # 33.6以上
}

counts = {'south': 0, 'center': 0, 'north': 0}

with open(input_file, 'r', encoding='utf-8') as f:
    for line in f:
        if line.strip():
            try:
                feature = json.loads(line)
                coords = feature['geometry']['coordinates']
                lat = coords[1]
                
                # 緯度範囲で分類
                if lat < 33.4:
                    region = 'south'
                elif lat < 33.6:
                    region = 'center'
                else:
                    region = 'north'
                
                regions[region].write(json.dumps(feature, ensure_ascii=False) + '\n')
                counts[region] += 1
            except (json.JSONDecodeError, KeyError, IndexError):
                continue

# ファイルを閉じる
for f in regions.values():
    f.close()

total = sum(counts.values())
print(f"Total features: {total}")
for region, count in counts.items():
    print(f"  {region}: {count}")
print(f"\nFiles written to {output_dir}")

