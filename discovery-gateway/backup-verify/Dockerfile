FROM postgres:18-alpine
COPY --chmod=0555 verify-restore.sh /usr/local/bin/verify-restore
USER postgres
ENTRYPOINT ["/usr/local/bin/verify-restore"]
