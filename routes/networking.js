import { useState, useEffect } from 'react';
import { confirmDialog } from '../../components/ui/Confirm.jsx';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { eventosApi } from '../../api/eventos.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { EstadoBadge, ModalidadBadge } from '../../components/ui/Badge.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import GLoader from '../../components/ui/GLoader.jsx';

import ResumenTab        from './tabs/ResumenTab.jsx';
import PaginaPublicaTab  from './tabs/PaginaPublicaTab.jsx';
import EquipoTab         from './tabs/EquipoTab.jsx';
import TicketsTab        from './tabs/TicketsTab.jsx';
import FormularioTab     from './tabs/FormularioTab.jsx';
import ClientesTab       from './tabs/ClientesTab.jsx';
import CheckinTab        from './tabs/CheckinTab.jsx';
import ChatTab           from './tabs/ChatTab.jsx';
import AgendaTab         from './tabs/AgendaTab.jsx';
import TareasTab         from './tabs/TareasTab.jsx';
import SolicitudesTab    from './tabs/SolicitudesTab.jsx';
import RankingTab        from './tabs/RankingTab.jsx';
import AnalyticsTab      from './tabs/AnalyticsTab.jsx';
import BroadcastModal    from './BroadcastModal.jsx';
import PlaceholderTab    from './tabs/PlaceholderTab.jsx';
import WaitlistTab      from './tabs/WaitlistTab.jsx';
import NetworkingTab    from './tabs/NetworkingTab.jsx';

/* Workspace por evento. Header + tabs. Cada tab carga su contenido. */

/* Categorías donde tiene sentido la Rueda de Negocios — debe coincidir con
   CATEGORIAS_PERMITIDAS en routes/networking.js del backend. */
const CATEGORIAS_NETWORKING = ['negocios', 'marketing', 'tecnologia'];

const GRUPOS = [
  { label: 'General', items: [
    { id: 'resumen', label: 'Resumen' },
    { id: 'publica', label: 'Página pública' },
    { id: 'ranking', label: 'Ranking' },
  ] },
  { label: 'Organización', items: [
    { id: 'equipo',  label: 'Equipo y roles' },
    { id: 'tareas',  label: 'Tareas' },
    { id: 'solicitudes', label: 'Sugerencias' },
    { id: 'agenda',  label: 'Agenda' },
    { id: 'networking', label: 'Rueda de negocios' },
  ] },
  { label: 'Facturación', items: [
    { id: 'tickets',   label: 'Boletas' },
    { id: 'formulario', label: 'Formulario' },
    { id: 'pagos',     label: 'Pagos' },
    { id: 'analytics', label: 'Analytics' },
  ] },
  { label: 'Asistentes', items: [
    { id: 'checkin',  label: 'Check-in' },
    { id: 'gente',    label: 'Clientes' },
    { id: 'waitlist', label: 'Lista de espera' },
  ] },
];
const TAB_GRUPO = Object.fromEntries(
  GRUPOS.flatMap(g => g.items.map(it => [it.id, g.label]))
);

/* Permiso requerido para que un MIEMBRO (no owner) vea cada tab.
   null = visible para todo el equipo. El owner siempre ve todo. */
const TAB_PERM = {
  resumen: null, publica: 'editar_pagina_publica',
  tickets: 'gestionar_tickets', pagos: 'ver_pagos', analytics: 'ver_analytics',
  formulario: 'gestionar_tickets',
  checkin: 'checkin', gente: 'ver_clientes', waitlist: '__solo_owner__',
  equipo: ['gestionar_roles', 'invitar_staff', 'remover_miembros'],
  agenda: null, tareas: null, solicitudes: null, chat: null, ranking: null,
  networking: null,
};
function puedeVerTab(id, soyOwner, permisos) {
  if (soyOwner) return true;
  const req = TAB_PERM[id];
  if (req == null) return true;
  const arr = Array.isArray(req) ? req : [req];
  return arr.some(p => (permisos || []).includes(p));
}

export default function EventDetailPage() {
  const { id }                       = useParams();
  const navigate                     = useNavigate();
  const { usuario, hasPermiso }      = useAuth();
  const { success, error: toastErr } = useToast();

  const [evento,  setEvento]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [tab,     setTab]     = useState('resumen');
  const [err,     setErr]     = useState('');
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [soyOwner, setSoyOwner] = useState(true);
  const [permisos, setPermisos] = useState(['*']);

  useEffect(() => {
    setLoading(true);
    eventosApi.get(id)
      .then(data => {
        setEvento(data.evento);
        const owner = data.soyOwner !== false;
        setSoyOwner(owner);
        setPermisos(data.permisos || ['*']);
        if (!owner) {
          setTab(t => puedeVerTab(t, false, data.permisos || []) ? t : 'resumen');
        }
      })
      .catch(e   => setErr(e.message))
      .finally(()=> setLoading(false));
  }, [id]);

  const reload = async () => {
    try { const d = await eventosApi.get(id); setEvento(d.evento); } catch {}
  };

  const doAction = async (action, confirmMsg) => {
    if (confirmMsg && !(await confirmDialog({ message:(confirmMsg), danger:true }))) return;
    setWorking(true);
    try {
      if (action === 'publicar') await eventosApi.publicar(id);
      if (action === 'cancelar') await eventosApi.cancelar(id);
      await reload();
      success('Acción aplicada.');
    } catch (e) {
      toastErr(e.message);
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async () => {
    if (!(await confirmDialog({ message:('¿Eliminar este evento? Esta acción no se puede deshacer.'), danger:true }))) return;
    setWorking(true);
    try {
      await eventosApi.delete(id);
      success('Evento eliminado.');
      navigate('/eventos');
    } catch (e) {
      toastErr(e.message);
      setWorking(false);
    }
  };

  if (loading) return (
    <GLoader size="lg" message="Cargando evento..." />
  );

  if (!evento) return (
    <div className="max-w-lg mx-auto mt-12 text-center">
      <p className="text-text-2 mb-4">{err || 'Evento no encontrado.'}</p>
      <Link to="/eventos" className="btn-secondary">← Volver a eventos</Link>
    </div>
  );

  const esDueno = String(evento.owner_id) === String(usuario?.id) || usuario?.rol === 'admin_global';
  const permiteNetworking = CATEGORIAS_NETWORKING.includes(evento.categoria?.slug);

  return (
    <div className="max-w-6xl mx-auto space-y-5 animate-[fadeUp_0.4s_ease_both]">
      {/* HEADER */}
      <WorkspaceHeader
        evento={evento}
        esDueno={esDueno}
        hasPermiso={hasPermiso}
        working={working}
        onPublicar={() => doAction('publicar')}
        onCancelar={() => doAction('cancelar', '¿Cancelar este evento?')}
        onDelete={handleDelete}
        onBroadcast={() => setBroadcastOpen(true)}
      />

      {/* NAV agrupada: grupos + Chat aparte; sub-tabs del grupo activo */}
      {(() => {
        const esChat = tab === 'chat';
        const gruposVis = GRUPOS
          .map(g => ({
            ...g,
            items: g.items
              .filter(it => puedeVerTab(it.id, soyOwner, permisos))
              /* La pestaña de Rueda de Negocios solo aparece si la categoría
                 del evento admite este módulo (Negocios, Marketing, Tecnología). */
              .filter(it => it.id !== 'networking' || permiteNetworking),
          }))
          .filter(g => g.items.length);
        const grupoActivo = esChat ? null : (TAB_GRUPO[tab] || gruposVis[0]?.label);
        const grupo = gruposVis.find(g => g.label === grupoActivo);
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
              {gruposVis.map(g => {
                const act = g.label === grupoActivo;
                return (
                  <button
                    key={g.label}
                    onClick={() => setTab(g.items[0].id)}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all
                      ${act
                        ? 'bg-gradient-primary text-white shadow-glow-sm'
                        : 'bg-surface-2 text-text-3 hover:text-text-1 border border-border'}`}
                  >
                    {g.label}
                  </button>
                );
              })}
              <span className="w-px h-6 bg-border mx-1 flex-shrink-0" />
              <button
                onClick={() => setTab('chat')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold
                  whitespace-nowrap transition-all
                  ${esChat
                    ? 'bg-gradient-primary text-white shadow-glow-sm'
                    : 'bg-surface-2 text-text-3 hover:text-text-1 border border-border'}`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Chat
              </button>
            </div>
            {grupo && (
              <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-border
                              -mx-4 px-4 sm:mx-0 sm:px-0">
                {grupo.items.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`relative px-4 py-3 text-[15px] font-medium whitespace-nowrap transition-colors
                      ${tab === t.id ? 'text-text-1' : 'text-text-3 hover:text-text-2'}`}
                  >
                    {t.label}
                    {tab === t.id && (
                      <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary animate-[fadeIn_0.2s_ease_both]" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* TAB CONTENT */}
      <div key={tab} className="animate-[fadeUp_0.3s_cubic-bezier(0.16,1,0.3,1)_both]">
        {tab === 'resumen'   && <ResumenTab evento={evento} />}
        {tab === 'publica'   && <PaginaPublicaTab evento={evento} />}
        {tab === 'equipo'    && <EquipoTab evento={evento} />}
        {tab === 'tickets'   && <TicketsTab evento={evento} />}
        {tab === 'formulario' && <FormularioTab evento={evento} />}
        {tab === 'gente'     && <ClientesTab evento={evento} />}
        {tab === 'checkin'   && <CheckinTab evento={evento} />}
        {tab === 'agenda'      && <AgendaTab evento={evento} />}
        {tab === 'tareas'      && <TareasTab evento={evento} />}
        {tab === 'solicitudes' && <SolicitudesTab evento={evento} />}
        {tab === 'ranking'     && <RankingTab evento={evento} />}
        {tab === 'networking'  && permiteNetworking && <NetworkingTab evento={evento} soyOwner={soyOwner} />}
        {tab === 'pagos'     && <PlaceholderTab title="Pagos" desc="Configura tu llave BRE-B, recibe transacciones, emite reembolsos." icon="wallet" />}
        {tab === 'chat'      && <ChatTab evento={evento} />}
        {tab === 'analytics' && <AnalyticsTab evento={evento} />}
        {tab === 'waitlist'  && <WaitlistTab evento={evento} />}
      </div>

      {broadcastOpen && (
        <BroadcastModal evento={evento} onClose={() => setBroadcastOpen(false)} />
      )}
    </div>
  );
}

function WorkspaceHeader({ evento, esDueno, hasPermiso, working, onPublicar, onCancelar, onDelete, onBroadcast }) {
  return (
    <header className="rounded-3xl border border-border overflow-hidden bg-surface/40">
      {/* Cover banner */}
      <div className="relative h-48 sm:h-64 overflow-hidden bg-gradient-to-br from-surface-2 via-surface to-bg">
        {(evento.cover_url || evento.gallery?.[0]) ? (
          <img
            src={evento.cover_url || evento.gallery[0]}
            alt={evento.titulo}
            className="absolute inset-0 w-full h-full object-cover scale-105 animate-[fadeIn_0.7s_ease_both]"
          />
        ) : (
          /* Patrón decorativo si no hay cover */
          <div className="absolute inset-0">
            <div className="absolute -top-20 left-1/3 w-96 h-96 rounded-full bg-primary/15 blur-3xl" />
            <div className="absolute -bottom-20 right-1/4 w-96 h-96 rounded-full bg-accent/15 blur-3xl" />
            <div className="absolute inset-0 opacity-[0.04]"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='32' height='32' fill='none' stroke='%23ffffff'%3e%3cpath d='M0 .5H31.5V32'/%3e%3c/svg%3e\")" }} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/70 to-transparent" />
      </div>

      <div className="px-6 sm:px-8 -mt-12 relative">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <EstadoBadge estado={evento.estado} />
              <ModalidadBadge modalidad={evento.modalidad} />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold font-display text-text-1 tracking-tight">{evento.titulo}</h1>
            {evento.descripcion && (
              <p className="text-base text-text-2 mt-2 max-w-2xl line-clamp-2 leading-relaxed">{evento.descripcion}</p>
            )}
            <p className="text-sm text-text-3 mt-3 font-mono">
              /explorar/{evento.slug}
            </p>
          </div>

          {/* Acciones */}
          {esDueno && (
            <div className="flex items-center gap-2 flex-wrap pt-2">
              {hasPermiso('eventos:editar') && evento.estado !== 'cancelado' && (
                <Link to={`/eventos/${evento.id}/editar`} className="btn-secondary btn-sm">
                  <EditIcon className="w-4 h-4" /> Editar info
                </Link>
              )}
              {hasPermiso('eventos:publicar') && evento.estado === 'borrador' && (
                <button onClick={onPublicar} disabled={working} className="btn-gradient btn-sm">
                  <RocketIcon className="w-4 h-4" /> Publicar
                </button>
              )}
              {hasPermiso('eventos:editar') && evento.estado === 'publicado' && (
                <button onClick={onCancelar} disabled={working} className="btn-secondary btn-sm">
                  Cancelar
                </button>
              )}
              {evento.estado === 'publicado' && (
                <button onClick={onBroadcast} className="btn-secondary btn-sm" title="Enviar notificación al equipo del evento (Pro)">
                  <BellIcon className="w-4 h-4" /> Notificar
                </button>
              )}
              {hasPermiso('eventos:eliminar') && (
                <button onClick={onDelete} disabled={working} className="btn-ghost btn-sm text-danger/80 hover:text-danger" aria-label="Eliminar">
                  <TrashIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="h-6" />
      </div>
    </header>
  );
}

function BellIcon({ className }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>;
}
function EditIcon({ className }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>;
}
function RocketIcon({ className }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;
}
function TrashIcon({ className }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
}
