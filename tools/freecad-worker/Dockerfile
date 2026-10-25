# freecad-worker (U3531): FreeCAD with its BIM workbench and IfcOpenShell, headless.
# A script runs in a fresh container per job, through run.sh: no network, read-only root.
FROM mambaorg/micromamba:1.5.10
USER root
RUN micromamba install -y -n base -c conda-forge freecad ifcopenshell numpy matplotlib \
 && micromamba clean -a -y
ENV PATH=/opt/conda/bin:$PATH QT_QPA_PLATFORM=offscreen HOME=/tmp MPLCONFIGDIR=/tmp
# `import FreeCAD` from plain python: FreeCAD.so sits in the prefix's lib
RUN python -c "import FreeCAD" 2>/dev/null \
 || echo /opt/conda/lib > "$(python -c 'import site; print(site.getsitepackages()[0])')/freecad.pth"
RUN python -c "import FreeCAD, Part, Arch, Spreadsheet, ifcopenshell, ifcopenshell.api, ifcopenshell.geom, json, sys; \
json.dump({'freecad': '.'.join(FreeCAD.Version()[:3]), 'ifcopenshell': ifcopenshell.version, 'python': sys.version.split()[0]}, open('/opt/versions.json', 'w'))" \
 && cat /opt/versions.json
ENTRYPOINT []
USER 1000
WORKDIR /work
