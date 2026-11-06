ALTER TABLE students ADD COLUMN block_avatar text NOT NULL DEFAULT '{"color":"ocean","face":"smile","accessory":"none","level":1,"owned":[]}';
--> statement-breakpoint
ALTER TABLE students ADD COLUMN awards text NOT NULL DEFAULT '{}';
--> statement-breakpoint
UPDATE students SET awards=json_object('first-puzzle',total_solved>=1,'puzzle-five',total_solved>=5,'puzzle-twenty',total_solved>=20,'perfect',EXISTS(SELECT 1 FROM records WHERE records.student_id=students.id AND json_extract(records.data,'$.mistakes')=0 AND json_extract(records.data,'$.assisted')=0),'streak-three',streak>=3);
