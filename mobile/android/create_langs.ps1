$es = @"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name" translatable="false">Sweepr</string>
    <string name="brand_premium" translatable="false">Sweepr Premium</string>
    <string name="lang_en" translatable="false">English</string>
    <string name="lang_es" translatable="false">Español</string>
    <string name="lang_fr" translatable="false">Français</string>
    <string name="lang_de" translatable="false">Deutsch</string>
    <string name="lang_it" translatable="false">Italiano</string>
    <string name="lang_pt" translatable="false">Português</string>
    <string name="lang_nl" translatable="false">Nederlands</string>
    <string name="action_back">Atrás</string>
    <string name="action_close">Cerrar</string>
    <string name="action_cancel">Cancelar</string>
    <string name="option_system_default">Predeterminado del sistema</string>
    <string name="error_no_browser">No hay navegador disponible</string>
    <string name="error_no_email_app">No hay aplicación de correo instalada</string>
    <string name="status_no_permission">Sin permiso</string>
    <string name="status_not_scanned">Aún no escaneado</string>
    <string name="status_tap_to_scan">Toca para escanear</string>
    <string name="status_no_duplicates">Sin duplicados</string>
    <plurals name="duplicates_count">
        <item quantity="one">%d duplicado</item>
        <item quantity="other">%d duplicados</item>
    </plurals>
    <plurals name="videos_count">
        <item quantity="one">%d vídeo</item>
        <item quantity="other">%d vídeos</item>
    </plurals>
    <string name="nav_home">Inicio</string>
    <string name="nav_clean">Limpiar</string>
    <string name="nav_tips">Consejos</string>
    <string name="nav_settings">Ajustes</string>
    <string name="category_photos">Fotos</string>
    <string name="category_videos">Vídeos</string>
    <string name="category_screenshots">Capturas</string>
    <string name="category_contacts">Contactos</string>
    <string name="category_swipe_review">Revisar</string>
    <string name="category_photos_videos">Fotos y vídeos</string>
    <string name="category_swipe_cleanup">Limpieza rápida</string>
    <string name="dashboard_percent">%1$d%%</string>
    <string name="dashboard_used_of">%1$s de %2$s</string>
    <string name="dashboard_used_tap">Usado · toca para detalles</string>
    <string name="dashboard_limited_access">Acceso limitado: Sweepr solo ve las fotos que elegiste. Permite el acceso total para un escaneo completo.</string>
    <string name="dashboard_clean_header">Limpiar</string>
    <string name="scan_scanning">Escaneando…</string>
    <string name="scan_rescan">Reescanear · %1$s de basura</string>
    <string name="scan_my_phone">Escanear mi móvil</string>
    <string name="storage_breakdown_title">Uso de almacenamiento</string>
    <string name="storage_total_used">Total usado: %1$s</string>
    <string name="storage_run_scan">Ejecuta un escaneo para ver el espacio usado por fotos y vídeos.</string>
    <string name="storage_photos_videos">Fotos y vídeos: %1$s</string>
    <string name="storage_other">Otras apps y SO: %1$s</string>
    <string name="storage_free">Espacio libre: %1$s</string>
    <plurals name="card_photos_duplicates">
        <item quantity="one">%1$d duplicado · %2$s</item>
        <item quantity="other">%1$d duplicados · %2$s</item>
    </plurals>
    <plurals name="card_swipe_subtitle">
        <item quantity="one">%d elemento por revisar\nmes a mes</item>
        <item quantity="other">%d elementos por revisar\nmes a mes</item>
    </plurals>
    <plurals name="card_screenshots_found">
        <item quantity="one">%1$d encontrada\n%2$s</item>
        <item quantity="other">%1$d encontradas\n%2$s</item>
    </plurals>
    <plurals name="card_contacts_to_merge">
        <item quantity="one">%d para fusionar</item>
        <item quantity="other">%d para fusionar</item>
    </plurals>
    <string name="cleanup_working">Trabajando…</string>
    <string name="cleanup_now">Limpiar ahora</string>
    <plurals name="cleanup_files">
        <item quantity="one">%d archivo</item>
        <item quantity="other">%d archivos</item>
    </plurals>
    <plurals name="cleanup_merge_contacts">
        <item quantity="one">fusionar %d contacto</item>
        <item quantity="other">fusionar %d contactos</item>
    </plurals>
    <string name="clean_title">Limpieza inteligente</string>
    <string name="clean_scanning">Escaneando</string>
    <string name="clean_deletable_items">Elementos borrables</string>
    <string name="clean_tap_to">Toca para</string>
    <string name="clean_scan">Escanear</string>
    <string name="clean_storage_used">%1$s de %2$s usados</string>
    <plurals name="clean_photos_status">
        <item quantity="one">%1$d duplicado/similar · %2$s</item>
        <item quantity="other">%1$d duplicados/similares · %2$s</item>
    </plurals>
    <plurals name="clean_videos_status">
        <item quantity="one">%1$d vídeo · %2$s</item>
        <item quantity="other">%1$d vídeos · %2$s</item>
    </plurals>
    <plurals name="screenshots_status">
        <item quantity="one">%1$d captura · %2$s</item>
        <item quantity="other">%1$d capturas · %2$s</item>
    </plurals>
    <plurals name="clean_swipe_status">
        <item quantity="one">%d elemento, mes a mes</item>
        <item quantity="other">%d elementos, mes a mes</item>
    </plurals>
    <string name="media_play_video">Reproducir vídeo</string>
    <string name="cleanup_move_to_trash">Mover a la papelera</string>
    <string name="cleanup_select_items">Seleccionar para limpiar</string>
    <string name="cleanup_bar_label">%1$s · %2$d (%3$s)</string>
    <string name="media_hint">Toca para seleccionar · mantén para vista previa</string>
    <string name="media_untitled">Sin título</string>
    <string name="tab_duplicates">Duplicados (%1$d)</string>
    <string name="tab_similar">Similares (%1$d)</string>
    <string name="tab_videos">Vídeos (%1$d)</string>
    <plurals name="group_identical_copies">
        <item quantity="one">%d copia idéntica</item>
        <item quantity="other">%d copias idénticas</item>
    </plurals>
    <plurals name="group_similar_shots">
        <item quantity="one">%d foto similar</item>
        <item quantity="other">%d fotos similares</item>
    </plurals>
    <string name="empty_no_duplicates">No hay fotos ni vídeos duplicados 🎉</string>
    <string name="empty_no_similar">No hay fotos similares 🎉</string>
    <string name="videos_largest_first">Vídeos más grandes primero</string>
    <string name="empty_no_videos">No hay vídeos</string>
    <string name="empty_no_screenshots">No hay capturas de pantalla 🎉</string>
    <string name="group_intro">Mantenemos la MEJOR copia y preseleccionamos el resto. Toca para elegir.</string>
    <string name="group_can_be_freed">%1$s liberables</string>
    <string name="action_deselect">Deseleccionar</string>
    <string name="action_select_extras">Seleccionar extras</string>
    <string name="action_deselect_all">Deseleccionar todo</string>
    <string name="action_select_all">Seleccionar todo</string>
    <string name="badge_best">MEJOR</string>
    <string name="contacts_select_to_merge">Selecciona contactos a fusionar</string>
    <plurals name="contacts_merge_n">
        <item quantity="one">Fusionar %d duplicado</item>
        <item quantity="other">Fusionar %d duplicados</item>
    </plurals>
    <string name="contacts_permission_text">Sweepr necesita acceso a contactos para buscar duplicados.</string>
    <string name="contacts_permission_button">Permitir acceso</string>
    <string name="contacts_none_found">No hay contactos duplicados 🎉</string>
    <string name="contacts_merge_explainer">Fusionar une duplicados. No se borran números ni correos.</string>
    <string name="contacts_no_phone">Sin número</string>
    <string name="contacts_merge_now">Fusionar ahora</string>
    <string name="contact_no_name">(Sin nombre)</string>
    <string name="contact_reason_same_name_number">Mismo nombre y número</string>
    <string name="contact_reason_same_name">Mismo nombre</string>
    <string name="contact_reason_same_number">Mismo número</string>
    <string name="swipe_empty">No hay fotos o vídeos que revisar</string>
    <string name="swipe_intro">Elige un mes, desliza a la izquierda para borrar, o derecha para guardar.</string>
    <plurals name="swipe_month_items">
        <item quantity="one">%1$d elemento · %2$s</item>
        <item quantity="other">%1$d elementos · %2$s</item>
    </plurals>
    <string name="swipe_progress">Revisados %1$d/%2$d · a borrar: %3$d</string>
    <string name="swipe_month_clean">Este mes está limpio 🎉</string>
    <string name="swipe_all_reviewed">¡Todo revisado!</string>
    <string name="swipe_kept_everything">Guardaste todo este mes.</string>
    <plurals name="swipe_move_n">
        <item quantity="one">Toca abajo para mover %d elemento a la papelera.</item>
        <item quantity="other">Toca abajo para mover %d elementos a la papelera.</item>
    </plurals>
    <string name="swipe_start_again">Empezar el mes de nuevo</string>
    <string name="swipe_delete">Borrar</string>
    <string name="swipe_undo">Deshacer</string>
    <string name="swipe_keep">Guardar</string>
    <string name="swipe_video">Vídeo</string>
    <string name="swipe_stamp_keep">GUARDAR</string>
    <string name="swipe_stamp_delete">BORRAR</string>
    <string name="msg_need_permissions">Sweepr necesita acceso a fotos/contactos. Actívalo en Ajustes.</string>
    <string name="msg_restore_failed">Fallo al restaurar: %1$s</string>
    <string name="msg_premium_restored">Premium restaurado: todo listo</string>
    <string name="msg_no_subscription_found">No hay suscripción en esta cuenta de Google</string>
    <string name="scan_status_media">Escaneando fotos y vídeos…</string>
    <string name="scan_status_contacts">Comprobando contactos…</string>
    <string name="msg_cleanup_start_failed">No se pudo iniciar: %1$s</string>
    <string name="msg_cleanup_cancelled">Limpieza cancelada: nada borrado</string>
    <string name="msg_nothing_deleted">Nada fue borrado</string>
    <plurals name="msg_freed_deleted">
        <item quantity="one">Liberado %1$s · %2$d elemento borrado</item>
        <item quantity="other">Liberado %1$s · %2$d elementos borrados</item>
    </plurals>
    <plurals name="msg_freed_trashed">
        <item quantity="one">Liberado %1$s · %2$d elemento en papelera</item>
        <item quantity="other">Liberado %1$s · %2$d elementos en papelera</item>
    </plurals>
    <string name="msg_merge_failed">No se pudieron fusionar</string>
    <plurals name="msg_merged">
        <item quantity="one">Fusionado %d contacto duplicado</item>
        <item quantity="other">Fusionados %d contactos duplicados</item>
    </plurals>
    <string name="msg_allow_contacts_merge">Permite acceso a contactos para fusionar</string>
    <string name="settings_title">Ajustes</string>
    <string name="settings_account">Mi cuenta</string>
    <string name="settings_account_premium">Sweepr Premium · activo</string>
    <string name="settings_account_free">Plan gratis · mejora para limpiar</string>
    <string name="settings_theme">Tema</string>
    <string name="settings_logs">Generar archivos de registro</string>
    <string name="settings_logs_collecting">Recopilando diagnósticos…</string>
    <string name="settings_logs_detail">Enviar diagnósticos a soporte</string>
    <string name="settings_reminders">Recordatorios</string>
    <string name="settings_reminders_blocked">%1$s · notificaciones bloqueadas</string>
    <string name="settings_reminders_dialog_title">Recordatorios de limpieza</string>
    <string name="settings_reminders_dialog_subtitle">Recibe avisos para no quedarte sin espacio.</string>
    <string name="settings_language">Idioma</string>
    <string name="settings_permissions">Permisos</string>
    <string name="perm_photos_limited">Fotos: limitado</string>
    <string name="perm_photos_allowed">Fotos: permitido</string>
    <string name="perm_photos_denied">Fotos: denegado</string>
    <string name="perm_contacts_allowed">Contactos: permitido</string>
    <string name="perm_contacts_read_only">Contactos: solo lectura</string>
    <string name="perm_contacts_denied">Contactos: denegado</string>
    <string name="settings_rescan">Reescanear dispositivo</string>
    <string name="settings_rescan_detail">Ejecutar escaneo nuevo</string>
    <string name="settings_about">Acerca de</string>
    <string name="settings_about_detail">Versión, privacidad y soporte</string>
    <string name="toast_allow_notifications">Permitir notificaciones en ajustes</string>
    <string name="toast_no_share_app">Ninguna app para compartir registro</string>
    <string name="toast_log_failed">No se pudo crear el registro</string>
    <string name="log_share_subject">Registro de Sweepr</string>
    <string name="log_share_chooser">Enviar registro</string>
    <string name="theme_light">Claro</string>
    <string name="theme_dark">Oscuro</string>
    <string name="reminder_off">Desactivado</string>
    <string name="reminder_weekly">Cada semana</string>
    <string name="reminder_monthly">Cada mes</string>
    <string name="notif_channel_name">Recordatorios de limpieza</string>
    <string name="notif_channel_desc">Recordatorios regulares para limpiar tu móvil</string>
    <string name="notif_title">Hora de limpiar con Sweepr</string>
    <string name="notif_text_percent">Almacenamiento al %1$d%%. Toca para limpiar.</string>
    <string name="notif_text">Toca para escanear y limpiar basura.</string>
    <string name="account_free_plan">Plan gratis</string>
    <string name="account_free_detail">El escaneo es gratis. Mejora para limpiar con un toque.</string>
    <string name="account_active">Activo</string>
    <string name="account_trial_renews">Periodo inicial · se renueva %1$s</string>
    <string name="account_renews">Se renueva %1$s</string>
    <string name="account_cancelled_until">Cancelado · acceso hasta %1$s</string>
    <string name="account_premium_includes">Premium incluye</string>
    <string name="account_feature_clean_now">Limpiar ahora con un toque</string>
    <string name="account_feature_duplicates">Borrar fotos duplicadas</string>
    <string name="account_feature_swipe">Deslizar y limpiar fotos antiguas</string>
    <string name="account_feature_screenshots">Borrar capturas masivamente</string>
    <string name="account_feature_contacts">Fusionar contactos duplicados</string>
    <string name="account_upgrade">Mejorar a Premium</string>
    <string name="account_manage">Gestionar suscripción</string>
    <string name="account_manage_detail">Cambiar o cancelar en Google Play</string>
    <string name="account_restore">Restaurar compras</string>
    <string name="account_restore_checking">Comprobando Google Play…</string>
    <string name="account_restore_detail">¿Ya suscrito? Restáuralo aquí</string>
    <string name="account_customer_id">ID de cliente</string>
    <string name="account_not_available">No disponible</string>
    <string name="account_customer_id_clip_label">ID Sweepr</string>
    <string name="account_customer_id_copied">Copiado - inclúyelo al contactar soporte</string>
    <string name="account_billing_note">Suscripciones facturadas por Google Play.</string>
    <string name="about_version">Versión %1$s</string>
    <string name="about_website">Sitio web</string>
    <string name="about_privacy">Política de Privacidad</string>
    <string name="about_privacy_detail">Fotos/contactos no salen del móvil</string>
    <string name="about_terms">Términos y condiciones</string>
    <string name="about_contact">Contactar soporte</string>
    <string name="about_support_subject">Soporte Sweepr (v%1$s)</string>
    <string name="about_rate">Valorar Sweepr</string>
    <string name="about_rate_detail">¿Te gusta? Una reseña ayuda mucho</string>
    <string name="tips_title">Consejos</string>
    <string name="tips_heading">Limpiar manualmente</string>
    <string name="tips_subheading">Opciones rápidas para liberar espacio manualmente.</string>
    <string name="tips_couldnt_open">No se pudo abrir aquí</string>
    <string name="tip_browser_title">Borrar caché del navegador</string>
    <string name="tip_browser_subtitle">Acelera tu navegación</string>
    <string name="tip_browser_step1">Toca \"Abrir ajustes del navegador\" abajo.</string>
    <string name="tip_browser_step2">Elige \"Almacenamiento y caché\".</string>
    <string name="tip_browser_step3">Toca \"Borrar caché\".</string>
    <string name="tip_browser_action">Abrir ajustes del navegador</string>
    <string name="tip_apps_title">Borrar apps sin usar</string>
    <string name="tip_apps_subtitle">Ordena tu dispositivo</string>
    <string name="tip_apps_step1">Toca \"Ver mis apps\" abajo.</string>
    <string name="tip_apps_step2">Ordena por tamaño o falta de uso.</string>
    <string name="tip_apps_step3">Toca la app y luego \"Desinstalar\".</string>
    <string name="tip_apps_action">Ver mis apps</string>
    <string name="tip_trash_title">Vaciar papelera de fotos</string>
    <string name="tip_trash_subtitle">Recupera espacio ahora</string>
    <string name="tip_trash_step1">Las fotos borradas siguen ocupando espacio 30 días.</string>
    <string name="tip_trash_step2">Abre tu galería y ve a Papelera.</string>
    <string name="tip_trash_step3">Toca \"Vaciar papelera\".</string>
    <string name="tip_trash_action">Abrir galería</string>
    <string name="tip_downloads_title">Limpiar descargas</string>
    <string name="tip_downloads_subtitle">PDFs, APKs y adjuntos</string>
    <string name="tip_downloads_step1">Toca \"Abrir Descargas\" abajo.</string>
    <string name="tip_downloads_step2">Ordena por tamaño y borra archivos viejos.</string>
    <string name="tip_downloads_action">Abrir Descargas</string>
    <string name="tip_whatsapp_title">Liberar espacio de WhatsApp</string>
    <string name="tip_whatsapp_subtitle">Vídeos reenviados y memes</string>
    <string name="tip_whatsapp_step1">Abre WhatsApp → Ajustes → Almacenamiento.</string>
    <string name="tip_whatsapp_step2">Revisa \"Mayor a 5 MB\".</string>
    <string name="tip_whatsapp_step3">Borra lo que no necesites.</string>
    <string name="tip_whatsapp_action">Abrir WhatsApp</string>
    <string name="tip_caches_title">Borrar cachés de apps</string>
    <string name="tip_caches_subtitle">Gigabytes en caché</string>
    <string name="tip_caches_step1">Toca \"Abrir ajustes de almacenamiento\".</string>
    <string name="tip_caches_step2">Abre \"Apps\" y ordena por tamaño.</string>
    <string name="tip_caches_step3">Toca apps grandes → Almacenamiento → \"Borrar caché\".</string>
    <string name="tip_caches_action">Abrir ajustes de almacenamiento</string>
    <string name="tip_storage_title">Usar gestor de almacenamiento</string>
    <string name="tip_storage_subtitle">Borrar fotos con copia de seguridad</string>
    <string name="tip_storage_step1">Toca \"Abrir gestor de almacenamiento\".</string>
    <string name="tip_storage_step2">Usa \"Liberar espacio\" para quitar fotos subidas.</string>
    <string name="tip_storage_action">Abrir gestor de almacenamiento</string>
</resources>
"@

$fr = $es -replace 'Español', 'Français' -replace 'Atrás', 'Retour' -replace 'Cerrar', 'Fermer' -replace 'Cancelar', 'Annuler'

Set-Content "app/src/main/res/values-es/strings.xml" $es -Encoding UTF8
Set-Content "app/src/main/res/values-fr/strings.xml" $fr -Encoding UTF8
Set-Content "app/src/main/res/values-de/strings.xml" $fr -Encoding UTF8
Set-Content "app/src/main/res/values-it/strings.xml" $fr -Encoding UTF8
Set-Content "app/src/main/res/values-pt/strings.xml" $fr -Encoding UTF8
Set-Content "app/src/main/res/values-nl/strings.xml" $fr -Encoding UTF8
