FROM postgres:18-alpine
# Open-source PostgreSQL client + age encryption + rclone S3 transport.
RUN apk add --no-cache bash age rclone jq
COPY backup.sh /usr/local/bin/atlas-backup
COPY recover.sh /usr/local/bin/atlas-recover
RUN chmod 0555 /usr/local/bin/atlas-backup /usr/local/bin/atlas-recover
USER postgres
ENTRYPOINT ["/usr/local/bin/atlas-backup"]
