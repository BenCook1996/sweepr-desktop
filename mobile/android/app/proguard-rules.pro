# Sweepr R8 / ProGuard rules (release build).
# Most libraries (Compose, WorkManager, RevenueCat, Coil, AppCompat) ship their own consumer rules;
# the rules below are belt-and-braces for classes that are created reflectively.

# WorkManager instantiates workers by class name (stored in its database) via the
# (Context, WorkerParameters) constructor – keep the name and constructor of our worker.
-keep class com.sweepr.app.ReminderWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}

# Application class is referenced from the manifest (AAPT generates a keep rule, kept here for clarity).
-keep class com.sweepr.app.SweeprApp { <init>(); }

# Keep line numbers for readable crash stack traces; hide original source file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
