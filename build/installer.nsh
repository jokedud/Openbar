!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    ${if} $R0 == '$INSTDIR\${APP_EXECUTABLE_FILENAME}'
    ${orIf} $R0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    ${endif}

    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    ${GetParent} "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}" $R0
    RMDir /r "$R0"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${endif}
!macroend
