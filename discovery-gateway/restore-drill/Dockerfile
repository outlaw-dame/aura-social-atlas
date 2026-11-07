FROM postgres:18-alpine
COPY verify-restore.sh /usr/local/bin/verify-restore
RUN chown postgres:postgres /usr/local/bin/verify-restore && chmod 0500 /usr/local/bin/verify-restore
USER postgres
ENTRYPOINT ["/usr/local/bin/verify-restore"]
