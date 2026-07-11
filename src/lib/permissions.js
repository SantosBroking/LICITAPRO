// permissions.js — Fase 1C: permisos centralizados por usuario/rol.
// Reemplaza las repeticiones de `user?.role==='admin' || user?.role==='jefe'`
// que existían en 6 lugares distintos (App.js, Admin.js, Firmas.js, Projects.js x4).
// 'jefe' era un valor muerto: el CHECK de user_profiles (desde Fase 0B) solo
// permite 'admin'/'empleado' — nunca puede existir de verdad en la base.
//
// Diseñado para aceptar roles futuros sin tocar 6 archivos otra vez: agregar
// un rol nuevo (ej. 'finanzas') es editar esta función, no cada vista.
export function getPermissions(user) {
  const role = user?.role; // Fase 1: solo 'admin' | 'empleado' existen en la base
  const isAdmin = role === 'admin';
  return {
    isAdmin,
    verFinanciero: isAdmin,
    verCotizacionCompleta: isAdmin,
    borrarProyectos: isAdmin,
    borrarVehiculos: isAdmin,
    gestionarUsuarios: isAdmin,
    verConfiguracion: isAdmin,
    // Operación general — cualquier usuario autenticado activo (rol presente)
    operarProyectos: !!role,
    subirDocumentos: !!role,
    usarIA: !!role,
  };
}
