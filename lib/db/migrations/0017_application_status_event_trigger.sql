-- Hace que sea imposible cambiar `application.status` sin dejar una fila en
-- `application_event` — criterio de aceptación 5. Una capa de servicio única
-- sólo garantiza que el código que hoy la respeta lo siga haciendo; un
-- trigger lo garantiza también contra un `UPDATE` hecho a mano desde `psql`.
--
-- La capa de servicio (lib/tracker/service.ts) nunca hace
-- `insert into application_event` para un cambio de estado. En cambio, abre
-- una transacción, declara con `set local` de dónde viene el cambio y (si
-- hace falta un tipo de evento más específico que el default) cuál es, y
-- después hace el `update` sobre `application.status` sin más. El trigger lee
-- esos dos GUCs de sesión — `app.event_detected_from` ('manual' | 'email' |
-- 'sistema', default 'manual') y `app.event_type` (default 'creada' en el
-- alta, 'cambio_manual' en la transición) — y son los únicos casos donde
-- distintos llamadores necesitan que el mismo `UPDATE` deje un evento
-- distinto: el cron de ghosting escribe 'ghosting_detectado' con
-- detected_from='sistema' antes de mover el estado, y la Fase 3 escribirá
-- 'invitacion_entrevista'/'oferta'/'rechazo' con detected_from='email'.
--
-- `gen_random_uuid()` requiere pgcrypto en Postgres < 13 (está en core desde
-- la 13). La extensión no rompe nada si ya está en core.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION application_touch_last_activity() RETURNS trigger AS $$
BEGIN
  -- Sólo un cambio de estado real cuenta como actividad. Editar una nota o un
  -- contacto no debe resetear el reloj que el cron de ghosting mira
  -- (`lib/tracker/ghosting.ts`) — si lo hiciera, un usuario que sólo agrega
  -- notas nunca sería marcado sin respuesta aunque el reclutador desapareció.
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_activity_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS application_touch_last_activity_trigger ON application;
--> statement-breakpoint

CREATE TRIGGER application_touch_last_activity_trigger
BEFORE UPDATE ON application
FOR EACH ROW EXECUTE FUNCTION application_touch_last_activity();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION application_status_event() RETURNS trigger AS $$
DECLARE
  v_event_type text;
  v_detected_from text;
BEGIN
  v_detected_from := coalesce(nullif(current_setting('app.event_detected_from', true), ''), 'manual');

  IF TG_OP = 'INSERT' THEN
    v_event_type := coalesce(nullif(current_setting('app.event_type', true), ''), 'creada');
    INSERT INTO application_event
      (id, application_id, event_type, from_status, to_status, detected_from, occurred_at)
    VALUES
      (gen_random_uuid()::text, NEW.id, v_event_type, NULL, NEW.status, v_detected_from, now());
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_event_type := coalesce(nullif(current_setting('app.event_type', true), ''), 'cambio_manual');
    INSERT INTO application_event
      (id, application_id, event_type, from_status, to_status, detected_from, occurred_at)
    VALUES
      (gen_random_uuid()::text, NEW.id, v_event_type, OLD.status, NEW.status, v_detected_from, now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS application_status_event_trigger ON application;
--> statement-breakpoint

CREATE TRIGGER application_status_event_trigger
AFTER INSERT OR UPDATE OF status ON application
FOR EACH ROW EXECUTE FUNCTION application_status_event();
