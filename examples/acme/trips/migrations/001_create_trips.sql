CREATE TYPE trip_status AS ENUM ('requested', 'completed', 'refunded');

CREATE TABLE trips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id    uuid NOT NULL,
  rider_email text NOT NULL,
  fare_cents  integer NOT NULL,
  refunded_cents integer NOT NULL DEFAULT 0,
  status      trip_status NOT NULL DEFAULT 'requested'
);
