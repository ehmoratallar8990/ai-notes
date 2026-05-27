export const messages = {
  en: {
    'auth.continueWithPasskey': 'Continue with passkey',
    'auth.createAccount': 'Create account',
    'auth.username': 'Username',
    'auth.displayName': 'Display name',
    'notes.title': 'AI Notes',
    'notes.newNote': 'New note',
    'notes.newRecording': 'New recording',
    'notes.save': 'Save note',
    'notes.folder': 'Folder',
    'recording.start': 'Start recording',
    'recording.stop': 'Stop recording',
    'ai.generateSummary': 'Generate summary',
    'ai.keyPoints': 'Key points',
    'ai.actionItems': 'Action items',
    'ai.mindMap': 'Mind map',
    'extension.autoRecord': 'Auto-record meetings'
  },
  es: {
    'auth.continueWithPasskey': 'Continuar con passkey',
    'auth.createAccount': 'Crear cuenta',
    'auth.username': 'Usuario',
    'auth.displayName': 'Nombre visible',
    'notes.title': 'Notas AI',
    'notes.newNote': 'Nueva nota',
    'notes.newRecording': 'Nueva grabación',
    'notes.save': 'Guardar nota',
    'notes.folder': 'Carpeta',
    'recording.start': 'Iniciar grabación',
    'recording.stop': 'Detener grabación',
    'ai.generateSummary': 'Generar resumen',
    'ai.keyPoints': 'Puntos clave',
    'ai.actionItems': 'Tareas pendientes',
    'ai.mindMap': 'Mapa mental',
    'extension.autoRecord': 'Auto-grabar reuniones'
  }
};
export function t(language, key) { return messages[language]?.[key] || messages.en[key] || key; }
