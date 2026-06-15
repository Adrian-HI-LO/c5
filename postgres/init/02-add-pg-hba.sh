#!/bin/bash
set -e
echo "host replication all 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"
# Recargar la configuración para aplicar el cambio
pg_ctl reload
