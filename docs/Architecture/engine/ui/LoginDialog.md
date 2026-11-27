# `ui/LoginDialog.h` / `LoginDialog.cpp`

The **Sign In** window: server address, email, password and *Remember me on this PC*. It signs in through [net/BackendClient](../net/BackendClient.md) with the same account as the web app. If sign-in fails it stays open and shows the server's message, and it closes as accepted once the user is signed in.

## Functions

### `LoginDialog(BackendClient* client, QWidget* parent)`
Builds the form, pre-filled with the client's server URL and saved email. The password field is masked. The *Remember me* tooltip explains that it keeps the user signed in for 7 days and that only the session is saved, never the password. A hidden red error label sits below, and the OK button reads *Sign In*.

It connects to `BackendClient::signInFinished`:
- if no sign-in is in progress, it ignores the signal (the result belongs to someone else, or the attempt was cancelled);
- on success it calls `accept()`;
- on failure it shows the error, selects the password and focuses it.

It focuses the email field if empty, otherwise the password field.

### `void submit()` *(private)*
1. Normalises the server URL (`NormalizeServerUrl`) and trims the email.
2. Checks the inputs. An invalid URL or empty host gives *"Enter the server address, e.g. http://localhost:5005."*; an empty email or password gives *"Enter your email and password."*
3. **Plain-HTTP warning:** if `IsInsecureRemote(server)` is true, it shows a Yes/No warning that the password would cross the network unencrypted. *No* is the default, and choosing it stops here.
4. Writes the normalised URL back into the field, hides the error, calls `setBusy(true)`, then `client->signIn(server, email, password, remember)`.

### `void reject()`
If a sign-in is in progress, it calls `client->cancelSignIn()` and clears the busy state, then closes.

### `void setBusy(bool)` *(private)*
Turns the four inputs and the OK button off or on, changes the button text to *"Signing In..."*, and sets the busy cursor.
