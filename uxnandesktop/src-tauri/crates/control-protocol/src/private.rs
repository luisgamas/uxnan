//! A file only its owner may read — the discovery file's one property that
//! matters, since the token in it is the user's key to the app.
//!
//! On Unix that is the mode: `0600`, checked as "no bits for group or others".
//! On Windows it is the file's **DACL**: [`restrict`] replaces it with one
//! explicit entry for the current user (protected, so nothing is inherited
//! from the profile folder), and [`check`] reads it back and refuses a file
//! whose entries grant anyone but the current user — the local SYSTEM account
//! and the Administrators group excepted, since both can read anything on the
//! machine regardless and every profile folder already lists them. The app
//! restricts on write; `uxnan-cli` checks on read; both through this module,
//! so the two sides cannot disagree about what "private" means.

use std::io;
use std::path::Path;

/// Make `path` readable and writable by its owner alone.
pub fn restrict(path: &Path) -> io::Result<()> {
    imp::restrict(path)
}

/// Whether `path` is readable by its owner alone. `Err` says who else can.
pub fn check(path: &Path) -> Result<(), String> {
    imp::check(path)
}

#[cfg(unix)]
mod imp {
    use std::io;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    pub fn restrict(path: &Path) -> io::Result<()> {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
    }

    pub fn check(path: &Path) -> Result<(), String> {
        let mode = std::fs::metadata(path)
            .map_err(|e| e.to_string())?
            .permissions()
            .mode()
            & 0o777;
        if mode & 0o077 != 0 {
            return Err(format!("readable by others (mode {mode:o})"));
        }
        Ok(())
    }
}

#[cfg(windows)]
mod imp {
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr;

    use windows_sys::Win32::Foundation::{
        CloseHandle, LocalFree, ERROR_SUCCESS, GENERIC_ALL, HANDLE, HLOCAL,
    };
    use windows_sys::Win32::Security::Authorization::{
        GetExplicitEntriesFromAclW, GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW,
        EXPLICIT_ACCESS_W, NO_MULTIPLE_TRUSTEE, SET_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID,
        TRUSTEE_IS_USER, TRUSTEE_W,
    };
    use windows_sys::Win32::Security::{
        CreateWellKnownSid, EqualSid, GetTokenInformation, TokenUser, WinBuiltinAdministratorsSid,
        WinLocalSystemSid, ACL, DACL_SECURITY_INFORMATION, NO_INHERITANCE,
        PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_MAX_SID_SIZE,
        TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// The current user's SID, as the bytes of a `TOKEN_USER` (the SID points
    /// into the buffer, so the buffer must outlive every use of it).
    fn current_user() -> io::Result<Vec<u8>> {
        unsafe {
            let mut token: HANDLE = ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut needed = 0u32;
            GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut needed);
            let mut buf = vec![0u8; needed as usize];
            let ok = GetTokenInformation(
                token,
                TokenUser,
                buf.as_mut_ptr() as *mut _,
                needed,
                &mut needed,
            );
            let err = io::Error::last_os_error();
            CloseHandle(token);
            if ok == 0 {
                return Err(err);
            }
            Ok(buf)
        }
    }

    fn sid_of(token_user: &[u8]) -> PSID {
        unsafe { (*(token_user.as_ptr() as *const TOKEN_USER)).User.Sid }
    }

    fn well_known(kind: i32) -> io::Result<Vec<u8>> {
        let mut buf = vec![0u8; SECURITY_MAX_SID_SIZE as usize];
        let mut size = buf.len() as u32;
        let ok = unsafe {
            CreateWellKnownSid(kind, ptr::null_mut(), buf.as_mut_ptr() as PSID, &mut size)
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(buf)
    }

    pub fn restrict(path: &Path) -> io::Result<()> {
        let user = current_user()?;
        let access = EXPLICIT_ACCESS_W {
            grfAccessPermissions: GENERIC_ALL,
            grfAccessMode: SET_ACCESS,
            grfInheritance: NO_INHERITANCE,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: ptr::null_mut(),
                MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_USER,
                ptstrName: sid_of(&user) as *mut u16,
            },
        };
        let mut dacl: *mut ACL = ptr::null_mut();
        let name = wide(path);
        unsafe {
            let rc = SetEntriesInAclW(1, &access, ptr::null(), &mut dacl);
            if rc != ERROR_SUCCESS {
                return Err(io::Error::from_raw_os_error(rc as i32));
            }
            let rc = SetNamedSecurityInfoW(
                name.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                dacl,
                ptr::null(),
            );
            LocalFree(dacl as HLOCAL);
            if rc != ERROR_SUCCESS {
                return Err(io::Error::from_raw_os_error(rc as i32));
            }
        }
        Ok(())
    }

    pub fn check(path: &Path) -> Result<(), String> {
        let user = current_user().map_err(|e| e.to_string())?;
        let system = well_known(WinLocalSystemSid).map_err(|e| e.to_string())?;
        let admins = well_known(WinBuiltinAdministratorsSid).map_err(|e| e.to_string())?;
        let allowed: [PSID; 3] = [
            sid_of(&user),
            system.as_ptr() as PSID,
            admins.as_ptr() as PSID,
        ];
        let name = wide(path);
        let mut dacl: *mut ACL = ptr::null_mut();
        let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
        unsafe {
            let rc = GetNamedSecurityInfoW(
                name.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut dacl,
                ptr::null_mut(),
                &mut descriptor,
            );
            if rc != ERROR_SUCCESS {
                return Err(io::Error::from_raw_os_error(rc as i32).to_string());
            }
            let result = (|| {
                if dacl.is_null() {
                    // A null DACL grants everyone everything.
                    return Err("has no access list: everyone may read it".to_string());
                }
                let mut count = 0u32;
                let mut entries: *mut EXPLICIT_ACCESS_W = ptr::null_mut();
                let rc = GetExplicitEntriesFromAclW(dacl, &mut count, &mut entries);
                if rc != ERROR_SUCCESS {
                    return Err(io::Error::from_raw_os_error(rc as i32).to_string());
                }
                let list = std::slice::from_raw_parts(entries, count as usize);
                let mut strangers = 0;
                for entry in list {
                    if entry.grfAccessMode != SET_ACCESS && entry.grfAccessMode != 1 {
                        // Only grants matter (GRANT_ACCESS = 1, SET_ACCESS = 2); a
                        // deny or an audit entry widens nothing.
                        continue;
                    }
                    if entry.Trustee.TrusteeForm != TRUSTEE_IS_SID {
                        strangers += 1;
                        continue;
                    }
                    let sid = entry.Trustee.ptstrName as PSID;
                    if !allowed.iter().any(|a| EqualSid(sid, *a) != 0) {
                        strangers += 1;
                    }
                }
                LocalFree(entries as HLOCAL);
                if strangers > 0 {
                    return Err(format!(
                        "its access list grants {strangers} account(s) other than you"
                    ));
                }
                Ok(())
            })();
            LocalFree(descriptor as HLOCAL);
            result
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_restricted_file_passes_and_a_shared_one_does_not() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("control.json");
        std::fs::write(&path, "{}").unwrap();
        restrict(&path).unwrap();
        assert_eq!(check(&path), Ok(()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
            let err = check(&path).unwrap_err();
            assert!(err.contains("readable by others"), "{err}");
            restrict(&path).unwrap();
            assert_eq!(check(&path), Ok(()));
        }
    }
}
