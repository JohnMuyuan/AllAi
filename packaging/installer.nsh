# AllAi 安装向导里「快捷方式」那一页。由 package.json 的 build.nsis.include 引进来。
#
# electron-builder 会在「装到哪个目录」之后插入 customPageAfterChangeDir、在文件装完之后
# 插入 customInstall（installSection.nsh 里 `addDesktopLink` / `addStartMenuLink` 的后面）。
#
# 两条路径都要对：
#   - 用户真的在装（有向导）：显示这一页，选完写进注册表；
#   - 静默安装 / 自动更新（`/S --updated`，页面根本不显示）：读注册表里上次的选择，
#     把当初没勾的那个链接删掉 —— 不然哪天自动更新一次，用户删掉的桌面图标又回来了。
#
# electron-builder 自己建链接的规矩一点没动（package.json 里两个开关都还是 true）：
# 它照旧先建好，这里按用户的选择删。升级路径和老版本完全一致。
#
# ⚠️ 这个文件在生成脚本里是**最前面**被 include 的 —— 那时 LogicLib、nsDialogs、MUI2
# 都还没进来，`${if}` / `${NSD_*}` / `${MUI_HEADER_TEXT}` 全是未定义。所以页面函数
# 必须写在宏体里（宏是在模板里展开的，那时这些宏都有了），不能写在文件顶层。

# 卸载器的编译里不展开上面的宏，这几个变量没人用 —— 而且 makensis 的
# 「没被引用」警告（6001）在 electron-builder 里是当错误处理的，所以要挡住。
!ifndef BUILD_UNINSTALLER
  Var shortcutChoice
  Var shortcutDesktopBox
  Var shortcutMenuBox
!endif

!macro customPageAfterChangeDir
  Page custom AllAiShortcutPageCreate AllAiShortcutPageLeave

  Function AllAiShortcutPageCreate
    # 自动更新（--updated）和静默安装不显示这一页
    ${if} ${isUpdated}
      Abort
    ${endif}
    ${if} ${Silent}
      Abort
    ${endif}

    !insertmacro MUI_HEADER_TEXT "快捷方式" "要不要在桌面和开始菜单放 AllAi。以后不想用了，删掉图标就行。"

    nsDialogs::Create 1018
    Pop $0
    ${if} $0 == error
      Abort
    ${endif}

    ${NSD_CreateCheckbox} 0 0 100% 12u "创建桌面快捷方式"
    Pop $shortcutDesktopBox
    ${NSD_Check} $shortcutDesktopBox

    ${NSD_CreateCheckbox} 0 16u 100% 12u "添加到开始菜单"
    Pop $shortcutMenuBox
    ${NSD_Check} $shortcutMenuBox

    nsDialogs::Show
  FunctionEnd

  Function AllAiShortcutPageLeave
    StrCpy $shortcutChoice "none"
    ${NSD_GetState} $shortcutDesktopBox $0
    ${if} $0 == ${BST_CHECKED}
      StrCpy $shortcutChoice "desktop"
    ${endif}
    ${NSD_GetState} $shortcutMenuBox $0
    ${if} $0 == ${BST_CHECKED}
      ${if} $shortcutChoice == "desktop"
        StrCpy $shortcutChoice "both"
      ${else}
        StrCpy $shortcutChoice "menu"
      ${endif}
    ${endif}
  FunctionEnd
!macroend

!macro customInstall
  ${if} $shortcutChoice == ""
    # 没走过向导（静默安装 / 自动更新）：沿用上一次存的选择
    ReadRegStr $shortcutChoice SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutChoice
    ${if} $shortcutChoice == ""
      StrCpy $shortcutChoice "both"
    ${endif}
  ${else}
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutChoice "$shortcutChoice"
  ${endif}

  ${if} $shortcutChoice != "both"
    ${if} $shortcutChoice != "desktop"
      Delete "$newDesktopLink"
    ${endif}
    ${if} $shortcutChoice != "menu"
      Delete "$newStartMenuLink"
    ${endif}
  ${endif}

  # 完成页的「运行 AllAi」和自动更新的 --force-run 都靠 $launchLink 启动，
  # 它原来指的是开始菜单那个链接。上面删掉了就得指回 exe，否则更新完起不来。
  ${if} ${FileExists} "$newStartMenuLink"
    StrCpy $launchLink "$newStartMenuLink"
  ${else}
    StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${endif}
!macroend