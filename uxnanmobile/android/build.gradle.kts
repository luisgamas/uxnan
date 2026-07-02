allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// file_picker's transitive `flutter_plugin_android_lifecycle` requires compiling
// against Android API 36+, but some Flutter plugin modules still pin compileSdk
// 34 (Flutter's current default), which fails `checkDebugAarMetadata`. Bump the
// plugin modules to at least 36 — compile-time only, each keeps its own
// minSdk/targetSdk. `:app` pins compileSdk itself (app/build.gradle.kts) and is
// eagerly evaluated by the block above, so skip it here. Reflection keeps this
// independent of the AGP DSL types (AGP 9 dropped the old `BaseExtension`).
subprojects {
    if (project.name != "app") {
        fun bumpCompileSdk() {
            val android = project.extensions.findByName("android") ?: return
            runCatching {
                val current =
                    android.javaClass.getMethod("getCompileSdk").invoke(android) as? Int
                if (current == null || current < 36) {
                    android.javaClass
                        .getMethod("setCompileSdk", Int::class.javaObjectType)
                        .invoke(android, 36)
                }
            }
        }
        if (project.state.executed) bumpCompileSdk() else afterEvaluate { bumpCompileSdk() }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
