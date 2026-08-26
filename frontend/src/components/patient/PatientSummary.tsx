import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ArrowLeft, Calendar, ClipboardList, FileText, FlaskConical, Loader2, MapPin, Pill, Stethoscope, UserRound,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import api from '../../services/api';
import type { ConsultaHistorialItem, ContextoClinicoPaciente, PacienteExpediente } from '../../types';
import clsx from 'clsx';

function estadoLabel(estado?: string | null) {
  if (estado === 'locked' || estado === 'finalizada') return 'Cerrada';
  if (estado === 'borrador') return 'Borrador';
  return estado || 'Consulta';
}

export default function PatientSummary() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [paciente, setPaciente] = useState<PacienteExpediente | null>(null);
  const [historial, setHistorial] = useState<ConsultaHistorialItem[]>([]);
  const [contextoApi, setContextoApi] = useState<ContextoClinicoPaciente | null>(null);
  const [medicamentos, setMedicamentos] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [savingMeds, setSavingMeds] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.getPaciente(id)
      .then((data) => {
        setPaciente(data.paciente);
        setHistorial(data.historial ?? []);
        setContextoApi(data.contexto_clinico ?? null);
        setMedicamentos(
          data.contexto_clinico?.medicamentos_habituales
            || data.paciente.antecedentes_importantes?.medicamentos_habituales
            || '',
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar el expediente.'))
      .finally(() => setLoading(false));
  }, [id]);

  const iniciarConsulta = async () => {
    if (!paciente) return;
    setStarting(true);
    setError('');
    try {
      const { consulta } = await api.abrirConsulta({
        pacienteId: paciente.id,
        especialidad: user?.specialty || 'medicina_general',
        medicoNombre: user?.full_name,
        medicoCedula: user?.credentials,
      });
      navigate(`/consulta/${consulta.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la consulta.');
    } finally {
      setStarting(false);
    }
  };

  const contexto = useMemo(
    () => contextoApi ?? (paciente ? derivarContextoLocal(paciente, historial) : vacioContexto()),
    [contextoApi, paciente, historial],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-24">
        <Loader2 className="w-7 h-7 text-teal-700 animate-spin" />
      </div>
    );
  }

  if (!paciente) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <p className="text-slate-600">{error || 'Expediente no disponible.'}</p>
        <button type="button" className="btn-secondary mt-4" onClick={() => navigate('/dashboard')}>
          Volver al buscador
        </button>
      </div>
    );
  }

  const antecedentes = paciente.antecedentes_importantes;
  const guardadoHabituales = (antecedentes?.medicamentos_habituales || contexto.medicamentos_habituales || '').trim();
  const medicamentosDirty = medicamentos.trim() !== guardadoHabituales;

  const guardarMedicamentos = async () => {
    if (!id || !medicamentosDirty) return;
    setSavingMeds(true);
    setError('');
    try {
      const data = await api.patchPacienteAntecedentes(id, { medicamentos_habituales: medicamentos.trim() });
      setPaciente(data.paciente);
      setHistorial(data.historial ?? historial);
      setContextoApi(data.contexto_clinico ?? null);
      setMedicamentos(
        data.contexto_clinico?.medicamentos_habituales
          || data.paciente.antecedentes_importantes?.medicamentos_habituales
          || '',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los medicamentos habituales.');
    } finally {
      setSavingMeds(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-start gap-3">
        <button type="button" className="btn-icon mt-0.5" onClick={() => navigate('/dashboard')} aria-label="Volver">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">Resumen del paciente</p>
          <h1 className="text-2xl font-semibold text-slate-900 mt-0.5 truncate">{paciente.nombre_completo}</h1>
          <p className="text-sm text-slate-500">Expediente {paciente.numero_expediente}</p>
        </div>
        <button type="button" className="btn-primary" disabled={starting} onClick={iniciarConsulta}>
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Stethoscope className="w-4 h-4" />}
          Iniciar Nueva Consulta
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <UserRound className="w-4 h-4 text-teal-700" />
          Datos demográficos
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          <Item label="Fecha de nacimiento" value={paciente.fecha_nacimiento} />
          <Item label="Edad" value={paciente.edad || '—'} />
          <Item label="Sexo" value={paciente.sexo || '—'} />
          <Item label="CURP" value={paciente.curp || '—'} />
          <Item label="Ocupación" value={paciente.ocupacion || '—'} />
          <Item label="Domicilio" value={paciente.domicilio || '—'} icon />
        </dl>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-teal-700" />
          Antecedentes clínicos
        </h2>
        <div className="space-y-4 text-sm">
          <p className={antecedentes?.alergias ? 'text-red-800' : 'text-slate-500'}>
            <span className="font-medium text-red-800">Alergias:</span>{' '}
            {antecedentes?.alergias || 'Sin registro'}
          </p>
          <p className="text-slate-700">
            <span className="font-medium">Enfermedades crónicas:</span>{' '}
            {antecedentes?.cronicos || <span className="text-slate-500">Sin registro</span>}
          </p>

          <div>
            <label htmlFor="medicamentos-habituales" className="font-medium text-slate-800 flex items-center gap-1.5">
              <Pill className="w-3.5 h-3.5 text-teal-700" />
              Medicamentos actuales / habituales
            </label>
            <p className="text-[11px] text-slate-400 mt-0.5 mb-2">
              Fármacos de base del paciente. Se guardan en el expediente y se copian a la siguiente consulta.
            </p>
            <textarea
              id="medicamentos-habituales"
              rows={3}
              value={medicamentos}
              onChange={(e) => setMedicamentos(e.target.value)}
              placeholder="Ej. Metformina 850 mg VO cada 12 h"
              className="input-field min-h-[5.5rem] resize-y"
            />
            <div className="mt-2 flex items-center justify-end">
              <button
                type="button"
                className="btn-primary text-sm py-2 px-4"
                disabled={!medicamentosDirty || savingMeds}
                onClick={guardarMedicamentos}
              >
                {savingMeds ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Guardar medicamentos
              </button>
            </div>
          </div>

          <DatoDesdeConsulta
            icon={<Stethoscope className="w-3.5 h-3.5 text-teal-700" />}
            label="Último tratamiento"
            value={contexto.ultimo_tratamiento}
            fecha={contexto.desde_fecha}
            vacio={contexto.desde_consulta_id ? 'Sin registro en la última consulta cerrada' : 'Sin consulta cerrada previa'}
          />
          <DatoDesdeConsulta
            icon={<FlaskConical className="w-3.5 h-3.5 text-teal-700" />}
            label="Estudios previos"
            value={contexto.estudios_previos}
            fecha={contexto.desde_fecha}
            vacio={contexto.desde_consulta_id ? 'Sin registro en la última consulta cerrada' : 'Sin consulta cerrada previa'}
          />
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-teal-700" />
          Historial de consultas
        </h2>
        {historial.length === 0 ? (
          <p className="text-sm text-slate-500">Sin consultas previas. Este será el primer registro del expediente.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {historial.map((item) => (
              <li key={item.id} className="py-3.5 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-slate-800">
                        {formatFecha(item.fecha_hora)}
                      </p>
                      <span className={clsx(
                        'badge',
                        item.estado === 'locked' || item.estado === 'finalizada' ? 'badge-slate' : 'badge-teal'
                      )}>
                        {estadoLabel(item.estado)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 mt-0.5">
                      {item.diagnostico || item.motivo_consulta || item.resumen || 'Consulta registrada'}
                    </p>
                    {item.plan && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{item.plan}</p>}
                  </div>
                  <button
                    type="button"
                    className="text-xs font-medium text-teal-700 hover:text-teal-800"
                    onClick={() => navigate(`/consulta/${item.id}`)}
                  >
                    Ver
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-400 mt-4">
          El historial es de solo lectura. Las notas cerradas no se modifican (NOM-004 5.11).
        </p>
      </section>
    </div>
  );
}

function Item({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{label}</dt>
      <dd className="text-slate-800 mt-0.5 flex items-start gap-1.5">
        {icon && <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />}
        {value}
      </dd>
    </div>
  );
}

function formatFecha(value: string) {
  try {
    return format(new Date(value), "d MMM yyyy, HH:mm", { locale: es });
  } catch {
    return String(value).slice(0, 16);
  }
}

function DatoDesdeConsulta({
  icon,
  label,
  value,
  fecha,
  vacio,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  fecha: string | null;
  vacio: string;
}) {
  return (
    <div>
      <p className="font-medium text-slate-800 flex items-center gap-1.5">
        {icon}
        {label}
      </p>
      <p className={value ? 'text-slate-700 mt-1 whitespace-pre-wrap' : 'text-slate-500 mt-1'}>
        {value || vacio}
      </p>
      {fecha && value && (
        <p className="text-[11px] text-slate-400 mt-1">De la consulta cerrada del {formatFecha(fecha)}</p>
      )}
    </div>
  );
}

function vacioContexto(): ContextoClinicoPaciente {
  return {
    medicamentos_habituales: '',
    ultimo_tratamiento: '',
    estudios_previos: '',
    desde_consulta_id: null,
    desde_fecha: null,
  };
}

function derivarContextoLocal(
  paciente: PacienteExpediente,
  historial: ConsultaHistorialItem[],
): ContextoClinicoPaciente {
  const cerrada = historial.find((item) => item.estado === 'locked' || item.estado === 'finalizada');
  return {
    medicamentos_habituales: paciente.antecedentes_importantes?.medicamentos_habituales || '',
    ultimo_tratamiento: (cerrada?.tratamiento_texto || textoTratamientoLocal(cerrada?.tratamiento, cerrada?.plan)).trim(),
    estudios_previos: (cerrada?.estudios ?? '').trim(),
    desde_consulta_id: cerrada?.id ?? null,
    desde_fecha: cerrada?.fecha_hora ?? null,
  };
}

function textoTratamientoLocal(tratamiento: unknown, plan?: string | null): string {
  if (Array.isArray(tratamiento)) {
    const lineas = tratamiento
      .map((item) => {
        const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        return [row.medicamento, row.dosis, row.via, row.periodicidad, row.instruccion]
          .map((part) => (typeof part === 'string' ? part.trim() : ''))
          .filter(Boolean)
          .join(' ');
      })
      .filter(Boolean);
    if (lineas.length) return lineas.join('. ');
  }
  if (typeof tratamiento === 'string' && tratamiento.trim()) return tratamiento.trim();
  return (plan ?? '').trim();
}
