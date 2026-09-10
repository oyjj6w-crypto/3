# Proguard rules for Android WebKit and Coroutines
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-dontwarn com.trading.multiview.**