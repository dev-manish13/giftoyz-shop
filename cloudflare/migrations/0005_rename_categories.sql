UPDATE taxonomy
SET data = json_set(data,
  '$.categories[' || (SELECT key FROM json_each(taxonomy.data, '$.categories') WHERE json_extract(value, '$.id') = 'doll') || '].en', 'Plush toys',
  '$.categories[' || (SELECT key FROM json_each(taxonomy.data, '$.categories') WHERE json_extract(value, '$.id') = 'doll') || '].ne', 'सफ्ट ट्वाय')
WHERE id = 1
  AND EXISTS (SELECT 1 FROM json_each(taxonomy.data, '$.categories') WHERE json_extract(value, '$.id') = 'doll' AND json_extract(value, '$.en') = 'Doll');

UPDATE taxonomy
SET data = json_set(data,
  '$.categories[' || (SELECT key FROM json_each(taxonomy.data, '$.categories') WHERE json_extract(value, '$.id') = 'gift-boxes') || '].en', 'Gifts & decor',
  '$.categories[' || (SELECT key FROM json_each(taxonomy.data, '$.categories') WHERE json_extract(value, '$.id') = 'gift-boxes') || '].ne', 'उपहार र सजावट')
WHERE id = 1
  AND EXISTS (SELECT 1 FROM json_each(taxonomy.data, '$.categories') WHERE json_extract(value, '$.id') = 'gift-boxes' AND json_extract(value, '$.en') = 'Gifts');
