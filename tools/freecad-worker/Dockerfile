# freecad-worker (U3531): FreeCAD with its BIM workbench and IfcOpenShell, headless.
# A script runs in a fresh container per job, through run.sh: no network, read-only root.
FROM mambaorg/micromamba:1.5.10
USER root
# headless only, in the same layer as the install so it is not kept: headers, static libs, docs, caches, and the
# workbenches a script here does not use (FEM, CAM, Robot, OpenSCAD, Inspection, tests); the import check below fails
# the build if any of it was needed. lark: IfcOpenShell's stream reader, which NativeIFC's open uses.
RUN micromamba install -y -n base -c conda-forge freecad ifcopenshell lark numpy matplotlib \
 && micromamba clean -a -y \
 && cd /opt/conda && rm -rf include share/doc share/man share/gtk-doc share/info conda-meta/*.json.bak pkgs \
 && find . -name "*.a" -delete && find . -name "__pycache__" -prune -exec rm -rf {} + \
 && rm -rf Mod/Fem Mod/CAM Mod/Robot Mod/OpenSCAD Mod/Inspection Mod/Test Mod/Help lib/python*/site-packages/*/tests \
 && du -sh /opt/conda
ENV PATH=/opt/conda/bin:$PATH QT_QPA_PLATFORM=offscreen HOME=/tmp MPLCONFIGDIR=/tmp
# `import FreeCAD` from plain python: FreeCAD.so sits in the prefix's lib
RUN python -c "import FreeCAD" 2>/dev/null \
 || echo /opt/conda/lib > "$(python -c 'import site; print(site.getsitepackages()[0])')/freecad.pth"
RUN python -c "import FreeCAD, Part, Arch, Spreadsheet, TechDraw, ifcopenshell, ifcopenshell.api, ifcopenshell.geom, lark, json, sys; from nativeifc import ifc_import; \
json.dump({'freecad': '.'.join(FreeCAD.Version()[:3]), 'ifcopenshell': ifcopenshell.version, 'python': sys.version.split()[0]}, open('/opt/versions.json', 'w'))" \
 && cat /opt/versions.json
ENTRYPOINT []
USER 1000
WORKDIR /work
