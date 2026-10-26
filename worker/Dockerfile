# The worker for IfcOpenShell scripts (U3531 route B, U3570's site constructions): the service, bubblewrap, and
# Python with IfcOpenShell's wheel. On the stack's internal network only (internal: true), no published port.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir "ifcopenshell>=0.8.4,<0.9" lark numpy \
 && python -c "import ifcopenshell, ifcopenshell.api, ifcopenshell.geom; print(ifcopenshell.version)" \
 && useradd -u 1000 -m worker && mkdir /jobs && chown worker /jobs
COPY service.py /srv/worker/
COPY steps /srv/worker/steps
USER worker
ENV WORKER_JOBS=/jobs PORT=8070
EXPOSE 8070
CMD ["python", "-I", "/srv/worker/service.py"]
