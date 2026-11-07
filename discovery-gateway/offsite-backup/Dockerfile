FROM postgres:18-alpine
# Open-source PostgreSQL client + age encryption + rclone S3 transport.
RUN apk add --no-cache bash age rclone
COPY backup.sh /usr/local/bin/atlas-backup
RUN chmod 0555 /usr/local/bin/atlas-backup
USER postgres
ENTRYPOINT ["/usr/local/bin/atlas-backup"]
