FROM ubuntu:20.04

# Install SSH server and monitoring tools
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
      openssh-server \
      sysstat \
      net-tools \
      procps && \
    mkdir -p /var/run/sshd

# Configure SSH for root login and authorized_keys
RUN echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config && \
    mkdir -p /root/.ssh && chmod 700 /root/.ssh

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
