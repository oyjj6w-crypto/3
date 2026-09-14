import os
import re

kotlin_files = [
    "app/src/main/java/com/trading/multiview/MainActivity.kt",
    "app/src/main/java/com/trading/multiview/ui/TradingMultiViewScreen.kt",
    "app/src/main/java/com/trading/multiview/ui/theme/Theme.kt",
    "app/src/main/java/com/trading/multiview/vpn/ClashVpnService.kt",
    "app/src/main/java/com/trading/multiview/vpn/ClashManager.kt",
    "app/src/main/java/com/trading/multiview/viewmodel/TradingViewModel.kt",
    "app/src/main/java/com/trading/multiview/webview/PersistentWebViewPool.kt"
]

for filepath in kotlin_files:
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        continue
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    print(f"\nChecking {filepath}...")
    
    # 1. Look for unresolved references of common types by checking usage vs imports
    # Intent
    if "Intent" in content and "import android.content.Intent" not in content and "package android.content" not in content:
        print("  [ERROR] 'Intent' is referenced but 'android.content.Intent' is not imported.")
    
    # Context
    if "Context" in content and "import android.content.Context" not in content:
        # Check if Context is defined as a class inside the file or imported
        # Wait, inside MainActivity.kt, is Context imported? It has requestedOrientation, etc. It doesn't use Context explicitly except as applicationContext.
        pass

    # Check for un-imported UI icons or compose classes
    # e.g., if Icons.Default.Close or Icons.Default.Security are used, make sure they are imported.
    if "Icons.Default" in content:
        if "import androidx.compose.material.icons.Icons" not in content:
            print("  [ERROR] 'Icons.Default' is referenced but 'androidx.compose.material.icons.Icons' is not imported.")
        if "Close" in content and "import androidx.compose.material.icons.filled.Close" not in content:
            print("  [ERROR] 'Close' icon is used but 'androidx.compose.material.icons.filled.Close' is not imported.")
        if "Security" in content and "import androidx.compose.material.icons.filled.Security" not in content:
            print("  [ERROR] 'Security' icon is used but 'androidx.compose.material.icons.filled.Security' is not imported.")

    # Check for correct imports of Card, CardDefaults, BorderStroke, etc. in TradingMultiViewScreen.kt
    if "Card" in content:
        if "import androidx.compose.material3.Card" not in content:
            print("  [ERROR] 'Card' is used but 'androidx.compose.material3.Card' is not imported.")
        if "CardDefaults" in content and "import androidx.compose.material3.CardDefaults" not in content:
            print("  [ERROR] 'CardDefaults' is used but 'androidx.compose.material3.CardDefaults' is not imported.")
            
    # Check for standard Compose mutableStateOf or remember
    if "mutableStateOf" in content and "import androidx.compose.runtime.mutableStateOf" not in content:
        print("  [ERROR] 'mutableStateOf' is used but 'androidx.compose.runtime.mutableStateOf' is not imported.")
    if "remember" in content and "import androidx.compose.runtime.remember" not in content:
        print("  [ERROR] 'remember' is used but 'androidx.compose.runtime.remember' is not imported.")

    print("  Done checking.")
