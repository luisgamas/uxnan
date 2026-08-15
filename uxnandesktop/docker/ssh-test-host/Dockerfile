# A Linux host to test the remote-hosts feature against.
#
# Every live SSH test so far has run against the `sshd` of the machine doing the
# testing — Windows, one OS, one shell. That made "it works on any OS" a claim
# nobody had checked: the POSIX branch of `shellkind`, of the inventory probe and
# of the git script had never actually run against a POSIX host.
#
# This is the smallest thing that closes that hole: Debian, `sshd`, `git`, and a
# user with a password. Password auth on purpose — it needs no key material to
# generate, distribute or clean up, and it happens to exercise the credential
# path a first-time user takes.
FROM debian:bookworm-slim

# `openssh-server` for the thing under test; `git` because the remote git layer
# is what runs on it; `procps`/`ca-certificates` so a shell on it behaves like a
# real machine rather than a stripped image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssh-server git procps ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The account the tests log in as. The password is fixed and public on purpose:
# this container listens on loopback only and holds nothing.
ARG UXNAN_USER=uxnan
ARG UXNAN_PASSWORD=uxnan
RUN useradd --create-home --shell /bin/bash "$UXNAN_USER" \
 && echo "$UXNAN_USER:$UXNAN_PASSWORD" | chpasswd \
 && mkdir -p /run/sshd

# A repository to read, so the remote git tests have a real worktree to ask
# about instead of an empty directory: a branch, a commit, and one dirty file.
USER ${UXNAN_USER}
WORKDIR /home/${UXNAN_USER}
RUN git config --global user.email "test@uxnan.local" \
 && git config --global user.name "uxnan test" \
 && git config --global init.defaultBranch main \
 && mkdir -p project \
 && cd project \
 && git init -q \
 && printf 'hello\n' > README.md \
 && git add README.md \
 && git commit -qm "first" \
 && printf 'dirty\n' >> README.md \
 && mkdir -p src && printf 'fn main() {}\n' > src/main.rs

# A folder that is *not* a repository, so the picker's badge has a negative case.
RUN mkdir -p /home/${UXNAN_USER}/plain-folder

USER root
# Password auth is what the tests use; root login stays off. `UsePAM no` keeps
# the container from needing a full PAM stack for a login to succeed.
RUN printf '%s\n' \
      'PasswordAuthentication yes' \
      'PermitRootLogin no' \
      'UsePAM no' \
      'PrintMotd no' \
      'AcceptEnv LANG LC_*' \
      > /etc/ssh/sshd_config.d/uxnan.conf

EXPOSE 22
# `-D` keeps it in the foreground (the container's whole job) and `-e` sends the
# log to stderr, where `docker logs` can show it when a test cannot get in.
CMD ["/usr/sbin/sshd", "-D", "-e"]
