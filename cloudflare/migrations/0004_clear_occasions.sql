UPDATE taxonomy SET data = json_set(data, '$.occasions', json('[]')) WHERE id = 1;
UPDATE products SET data = json_set(data, '$.occasions', json('[]'));
