# Reproducible geospatial toolchain for Copernico (GDAL/PROJ with IAU_2015 Mars CRSs).
# Base pinned by tag and digest (stable GDAL 3.13.3 with PROJ IAU_2015 CRSs) for reproducible builds.
FROM ghcr.io/osgeo/gdal:ubuntu-small-3.13.3@sha256:64250faf833c06d4b21afce4c27190039ba7ab58d70f0eebc87cf77d929c0b40

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3-pip python3-venv python3-numpy python3-dev g++ libglm-dev \
 && rm -rf /var/lib/apt/lists/*

# Virtualenv that still sees the system GDAL bindings (osgeo) and numpy.
RUN python3 -m venv --system-site-packages /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

ENV GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR \
    GDAL_HTTP_MAX_RETRY=5 \
    GDAL_HTTP_RETRY_DELAY=3 \
    CPL_VSIL_CURL_CHUNK_SIZE=10485760 \
    VSI_CACHE=TRUE \
    PYTHONUNBUFFERED=1 \
    COPERNICO_ROOT=/work

WORKDIR /work/scripts/geospatial
ENTRYPOINT ["python3", "-m", "copernico_geo"]
