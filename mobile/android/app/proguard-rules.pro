# Sweepr R8 / ProGuard rules (release build).
# Most libraries (Compose, WorkManager, RevenueCat, Coil, AppCompat) ship their own consumer rules;
# the rules below are belt-and-braces for classes that are created reflectively.

# WorkManager instantiates workers by class name (stored in its database) via the
# (Context, WorkerParameters) constructor – keep the name and constructor of our worker.
-keep class com.sweepr.app.ReminderWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keep class com.sweepr.app.BatteryCareWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keep class com.sweepr.app.BatteryUnplugWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keep class com.sweepr.app.StorageWidgetProvider { <init>(); }
-keepclassmembers enum com.sweepr.app.** {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Application class is referenced from the manifest (AAPT generates a keep rule, kept here for clarity).
-keep class com.sweepr.app.SweeprApp { <init>(); }

# Google Play In-App Updates & Billing Library classes
-keep class com.google.android.play.core.appupdate.** { *; }
-dontwarn com.google.android.play.core.appupdate.**
-keep class com.android.billingclient.** { *; }

# Keep line numbers for readable crash stack traces; hide original source file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
