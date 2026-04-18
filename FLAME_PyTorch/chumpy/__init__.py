"""
Minimal chumpy stub for Python 3.10+ / NumPy 2.x compatibility.

The FLAME generic_model.pkl was pickled with real chumpy, so unpickling it
requires 'chumpy.ch.Ch' to exist.  This stub replaces it with a plain
numpy-backed class so no actual chumpy installation is needed.
"""
import numpy as np
from .ch import Ch

def array(x, *args, **kwargs):
    return np.asarray(x)
