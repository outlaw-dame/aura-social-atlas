FROM postgres:18-alpine
COPY cleanup.sh /usr/local/bin/atlas-retention
RUN chmod 0555 /usr/local/bin/atlas-retention
USER postgres
ENTRYPOINT ["/usr/local/bin/atlas-retention"]
