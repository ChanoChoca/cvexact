-- Fase 3: extiende el trigger de la migración 0017 para que un cambio de
-- estado aplicado por el clasificador de email también deje `confidence`,
-- `raw_sender` y `raw_subject` en el evento que escribe solo — la auditoría
-- que docs/tracker-email-fase3.md exige ("guardar siempre raw_sender y
-- raw_subject... para poder auditar y mejorar las reglas con datos
-- reales"). Antes de esto el trigger sólo sabía `event_type` y
-- `detected_from`; `lib/tracker/email-ingest.ts` es el único llamador que
-- declara los tres GUCs nuevos, así que el resto del tracker (cambios
-- manuales, ghosting) simplemente no los setea y quedan NULL, como ya
-- pasaba.
CREATE OR REPLACE FUNCTION application_status_event() RETURNS trigger AS $$
DECLARE
  v_event_type text;
  v_detected_from text;
  v_confidence real;
  v_raw_sender text;
  v_raw_subject text;
BEGIN
  v_detected_from := coalesce(nullif(current_setting('app.event_detected_from', true), ''), 'manual');
  v_confidence := nullif(current_setting('app.event_confidence', true), '')::real;
  v_raw_sender := nullif(current_setting('app.event_raw_sender', true), '');
  v_raw_subject := nullif(current_setting('app.event_raw_subject', true), '');

  IF TG_OP = 'INSERT' THEN
    v_event_type := coalesce(nullif(current_setting('app.event_type', true), ''), 'creada');
    INSERT INTO application_event
      (id, application_id, event_type, from_status, to_status, detected_from, confidence, raw_sender, raw_subject, occurred_at)
    VALUES
      (gen_random_uuid()::text, NEW.id, v_event_type, NULL, NEW.status, v_detected_from, v_confidence, v_raw_sender, v_raw_subject, now());
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_event_type := coalesce(nullif(current_setting('app.event_type', true), ''), 'cambio_manual');
    INSERT INTO application_event
      (id, application_id, event_type, from_status, to_status, detected_from, confidence, raw_sender, raw_subject, occurred_at)
    VALUES
      (gen_random_uuid()::text, NEW.id, v_event_type, OLD.status, NEW.status, v_detected_from, v_confidence, v_raw_sender, v_raw_subject, now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
