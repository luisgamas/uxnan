// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'local_database.dart';

// ignore_for_file: type=lint
class $ThreadsTableTable extends ThreadsTable
    with TableInfo<$ThreadsTableTable, ThreadRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ThreadsTableTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _titleMeta = const VerificationMeta('title');
  @override
  late final GeneratedColumn<String> title = GeneratedColumn<String>(
      'title', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _projectIdMeta =
      const VerificationMeta('projectId');
  @override
  late final GeneratedColumn<String> projectId = GeneratedColumn<String>(
      'project_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _deviceIdMeta =
      const VerificationMeta('deviceId');
  @override
  late final GeneratedColumn<String> deviceId = GeneratedColumn<String>(
      'device_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _cwdMeta = const VerificationMeta('cwd');
  @override
  late final GeneratedColumn<String> cwd = GeneratedColumn<String>(
      'cwd', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _worktreePathMeta =
      const VerificationMeta('worktreePath');
  @override
  late final GeneratedColumn<String> worktreePath = GeneratedColumn<String>(
      'worktree_path', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _agentIdMeta =
      const VerificationMeta('agentId');
  @override
  late final GeneratedColumn<String> agentId = GeneratedColumn<String>(
      'agent_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _modelMeta = const VerificationMeta('model');
  @override
  late final GeneratedColumn<String> model = GeneratedColumn<String>(
      'model', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _syncStateMeta =
      const VerificationMeta('syncState');
  @override
  late final GeneratedColumn<String> syncState = GeneratedColumn<String>(
      'sync_state', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
      'status', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _lastActivityMsMeta =
      const VerificationMeta('lastActivityMs');
  @override
  late final GeneratedColumn<int> lastActivityMs = GeneratedColumn<int>(
      'last_activity_ms', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _createdAtMsMeta =
      const VerificationMeta('createdAtMs');
  @override
  late final GeneratedColumn<int> createdAtMs = GeneratedColumn<int>(
      'created_at_ms', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        title,
        projectId,
        deviceId,
        cwd,
        worktreePath,
        agentId,
        model,
        syncState,
        status,
        lastActivityMs,
        createdAtMs
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'threads_table';
  @override
  VerificationContext validateIntegrity(Insertable<ThreadRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('title')) {
      context.handle(
          _titleMeta, title.isAcceptableOrUnknown(data['title']!, _titleMeta));
    } else if (isInserting) {
      context.missing(_titleMeta);
    }
    if (data.containsKey('project_id')) {
      context.handle(_projectIdMeta,
          projectId.isAcceptableOrUnknown(data['project_id']!, _projectIdMeta));
    }
    if (data.containsKey('device_id')) {
      context.handle(_deviceIdMeta,
          deviceId.isAcceptableOrUnknown(data['device_id']!, _deviceIdMeta));
    }
    if (data.containsKey('cwd')) {
      context.handle(
          _cwdMeta, cwd.isAcceptableOrUnknown(data['cwd']!, _cwdMeta));
    }
    if (data.containsKey('worktree_path')) {
      context.handle(
          _worktreePathMeta,
          worktreePath.isAcceptableOrUnknown(
              data['worktree_path']!, _worktreePathMeta));
    }
    if (data.containsKey('agent_id')) {
      context.handle(_agentIdMeta,
          agentId.isAcceptableOrUnknown(data['agent_id']!, _agentIdMeta));
    } else if (isInserting) {
      context.missing(_agentIdMeta);
    }
    if (data.containsKey('model')) {
      context.handle(
          _modelMeta, model.isAcceptableOrUnknown(data['model']!, _modelMeta));
    }
    if (data.containsKey('sync_state')) {
      context.handle(_syncStateMeta,
          syncState.isAcceptableOrUnknown(data['sync_state']!, _syncStateMeta));
    } else if (isInserting) {
      context.missing(_syncStateMeta);
    }
    if (data.containsKey('status')) {
      context.handle(_statusMeta,
          status.isAcceptableOrUnknown(data['status']!, _statusMeta));
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('last_activity_ms')) {
      context.handle(
          _lastActivityMsMeta,
          lastActivityMs.isAcceptableOrUnknown(
              data['last_activity_ms']!, _lastActivityMsMeta));
    }
    if (data.containsKey('created_at_ms')) {
      context.handle(
          _createdAtMsMeta,
          createdAtMs.isAcceptableOrUnknown(
              data['created_at_ms']!, _createdAtMsMeta));
    } else if (isInserting) {
      context.missing(_createdAtMsMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  ThreadRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ThreadRow(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      title: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}title'])!,
      projectId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}project_id']),
      deviceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}device_id']),
      cwd: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}cwd']),
      worktreePath: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}worktree_path']),
      agentId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}agent_id'])!,
      model: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}model']),
      syncState: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}sync_state'])!,
      status: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}status'])!,
      lastActivityMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}last_activity_ms']),
      createdAtMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}created_at_ms'])!,
    );
  }

  @override
  $ThreadsTableTable createAlias(String alias) {
    return $ThreadsTableTable(attachedDatabase, alias);
  }
}

class ThreadRow extends DataClass implements Insertable<ThreadRow> {
  /// Unique thread id (primary key).
  final String id;

  /// Human readable title.
  final String title;

  /// Owning project id, if any.
  final String? projectId;

  /// `macDeviceId` of the paired PC this thread belongs to, if known. Lets the
  /// threads list be scoped to the selected device.
  final String? deviceId;

  /// Working directory on the PC, if known.
  final String? cwd;

  /// Backing git worktree path, if any.
  final String? worktreePath;

  /// Wire identifier of the handling agent.
  final String agentId;

  /// Model the agent runs (bridge id / display name), if known.
  final String? model;

  /// `ThreadSyncState` serialized as its enum name.
  final String syncState;

  /// `ThreadStatus` serialized as its enum name.
  final String status;

  /// Last activity timestamp in epoch milliseconds, if any.
  final int? lastActivityMs;

  /// Row creation timestamp in epoch milliseconds.
  final int createdAtMs;
  const ThreadRow(
      {required this.id,
      required this.title,
      this.projectId,
      this.deviceId,
      this.cwd,
      this.worktreePath,
      required this.agentId,
      this.model,
      required this.syncState,
      required this.status,
      this.lastActivityMs,
      required this.createdAtMs});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['title'] = Variable<String>(title);
    if (!nullToAbsent || projectId != null) {
      map['project_id'] = Variable<String>(projectId);
    }
    if (!nullToAbsent || deviceId != null) {
      map['device_id'] = Variable<String>(deviceId);
    }
    if (!nullToAbsent || cwd != null) {
      map['cwd'] = Variable<String>(cwd);
    }
    if (!nullToAbsent || worktreePath != null) {
      map['worktree_path'] = Variable<String>(worktreePath);
    }
    map['agent_id'] = Variable<String>(agentId);
    if (!nullToAbsent || model != null) {
      map['model'] = Variable<String>(model);
    }
    map['sync_state'] = Variable<String>(syncState);
    map['status'] = Variable<String>(status);
    if (!nullToAbsent || lastActivityMs != null) {
      map['last_activity_ms'] = Variable<int>(lastActivityMs);
    }
    map['created_at_ms'] = Variable<int>(createdAtMs);
    return map;
  }

  ThreadsTableCompanion toCompanion(bool nullToAbsent) {
    return ThreadsTableCompanion(
      id: Value(id),
      title: Value(title),
      projectId: projectId == null && nullToAbsent
          ? const Value.absent()
          : Value(projectId),
      deviceId: deviceId == null && nullToAbsent
          ? const Value.absent()
          : Value(deviceId),
      cwd: cwd == null && nullToAbsent ? const Value.absent() : Value(cwd),
      worktreePath: worktreePath == null && nullToAbsent
          ? const Value.absent()
          : Value(worktreePath),
      agentId: Value(agentId),
      model:
          model == null && nullToAbsent ? const Value.absent() : Value(model),
      syncState: Value(syncState),
      status: Value(status),
      lastActivityMs: lastActivityMs == null && nullToAbsent
          ? const Value.absent()
          : Value(lastActivityMs),
      createdAtMs: Value(createdAtMs),
    );
  }

  factory ThreadRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ThreadRow(
      id: serializer.fromJson<String>(json['id']),
      title: serializer.fromJson<String>(json['title']),
      projectId: serializer.fromJson<String?>(json['projectId']),
      deviceId: serializer.fromJson<String?>(json['deviceId']),
      cwd: serializer.fromJson<String?>(json['cwd']),
      worktreePath: serializer.fromJson<String?>(json['worktreePath']),
      agentId: serializer.fromJson<String>(json['agentId']),
      model: serializer.fromJson<String?>(json['model']),
      syncState: serializer.fromJson<String>(json['syncState']),
      status: serializer.fromJson<String>(json['status']),
      lastActivityMs: serializer.fromJson<int?>(json['lastActivityMs']),
      createdAtMs: serializer.fromJson<int>(json['createdAtMs']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'title': serializer.toJson<String>(title),
      'projectId': serializer.toJson<String?>(projectId),
      'deviceId': serializer.toJson<String?>(deviceId),
      'cwd': serializer.toJson<String?>(cwd),
      'worktreePath': serializer.toJson<String?>(worktreePath),
      'agentId': serializer.toJson<String>(agentId),
      'model': serializer.toJson<String?>(model),
      'syncState': serializer.toJson<String>(syncState),
      'status': serializer.toJson<String>(status),
      'lastActivityMs': serializer.toJson<int?>(lastActivityMs),
      'createdAtMs': serializer.toJson<int>(createdAtMs),
    };
  }

  ThreadRow copyWith(
          {String? id,
          String? title,
          Value<String?> projectId = const Value.absent(),
          Value<String?> deviceId = const Value.absent(),
          Value<String?> cwd = const Value.absent(),
          Value<String?> worktreePath = const Value.absent(),
          String? agentId,
          Value<String?> model = const Value.absent(),
          String? syncState,
          String? status,
          Value<int?> lastActivityMs = const Value.absent(),
          int? createdAtMs}) =>
      ThreadRow(
        id: id ?? this.id,
        title: title ?? this.title,
        projectId: projectId.present ? projectId.value : this.projectId,
        deviceId: deviceId.present ? deviceId.value : this.deviceId,
        cwd: cwd.present ? cwd.value : this.cwd,
        worktreePath:
            worktreePath.present ? worktreePath.value : this.worktreePath,
        agentId: agentId ?? this.agentId,
        model: model.present ? model.value : this.model,
        syncState: syncState ?? this.syncState,
        status: status ?? this.status,
        lastActivityMs:
            lastActivityMs.present ? lastActivityMs.value : this.lastActivityMs,
        createdAtMs: createdAtMs ?? this.createdAtMs,
      );
  ThreadRow copyWithCompanion(ThreadsTableCompanion data) {
    return ThreadRow(
      id: data.id.present ? data.id.value : this.id,
      title: data.title.present ? data.title.value : this.title,
      projectId: data.projectId.present ? data.projectId.value : this.projectId,
      deviceId: data.deviceId.present ? data.deviceId.value : this.deviceId,
      cwd: data.cwd.present ? data.cwd.value : this.cwd,
      worktreePath: data.worktreePath.present
          ? data.worktreePath.value
          : this.worktreePath,
      agentId: data.agentId.present ? data.agentId.value : this.agentId,
      model: data.model.present ? data.model.value : this.model,
      syncState: data.syncState.present ? data.syncState.value : this.syncState,
      status: data.status.present ? data.status.value : this.status,
      lastActivityMs: data.lastActivityMs.present
          ? data.lastActivityMs.value
          : this.lastActivityMs,
      createdAtMs:
          data.createdAtMs.present ? data.createdAtMs.value : this.createdAtMs,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ThreadRow(')
          ..write('id: $id, ')
          ..write('title: $title, ')
          ..write('projectId: $projectId, ')
          ..write('deviceId: $deviceId, ')
          ..write('cwd: $cwd, ')
          ..write('worktreePath: $worktreePath, ')
          ..write('agentId: $agentId, ')
          ..write('model: $model, ')
          ..write('syncState: $syncState, ')
          ..write('status: $status, ')
          ..write('lastActivityMs: $lastActivityMs, ')
          ..write('createdAtMs: $createdAtMs')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      title,
      projectId,
      deviceId,
      cwd,
      worktreePath,
      agentId,
      model,
      syncState,
      status,
      lastActivityMs,
      createdAtMs);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ThreadRow &&
          other.id == this.id &&
          other.title == this.title &&
          other.projectId == this.projectId &&
          other.deviceId == this.deviceId &&
          other.cwd == this.cwd &&
          other.worktreePath == this.worktreePath &&
          other.agentId == this.agentId &&
          other.model == this.model &&
          other.syncState == this.syncState &&
          other.status == this.status &&
          other.lastActivityMs == this.lastActivityMs &&
          other.createdAtMs == this.createdAtMs);
}

class ThreadsTableCompanion extends UpdateCompanion<ThreadRow> {
  final Value<String> id;
  final Value<String> title;
  final Value<String?> projectId;
  final Value<String?> deviceId;
  final Value<String?> cwd;
  final Value<String?> worktreePath;
  final Value<String> agentId;
  final Value<String?> model;
  final Value<String> syncState;
  final Value<String> status;
  final Value<int?> lastActivityMs;
  final Value<int> createdAtMs;
  final Value<int> rowid;
  const ThreadsTableCompanion({
    this.id = const Value.absent(),
    this.title = const Value.absent(),
    this.projectId = const Value.absent(),
    this.deviceId = const Value.absent(),
    this.cwd = const Value.absent(),
    this.worktreePath = const Value.absent(),
    this.agentId = const Value.absent(),
    this.model = const Value.absent(),
    this.syncState = const Value.absent(),
    this.status = const Value.absent(),
    this.lastActivityMs = const Value.absent(),
    this.createdAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ThreadsTableCompanion.insert({
    required String id,
    required String title,
    this.projectId = const Value.absent(),
    this.deviceId = const Value.absent(),
    this.cwd = const Value.absent(),
    this.worktreePath = const Value.absent(),
    required String agentId,
    this.model = const Value.absent(),
    required String syncState,
    required String status,
    this.lastActivityMs = const Value.absent(),
    required int createdAtMs,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        title = Value(title),
        agentId = Value(agentId),
        syncState = Value(syncState),
        status = Value(status),
        createdAtMs = Value(createdAtMs);
  static Insertable<ThreadRow> custom({
    Expression<String>? id,
    Expression<String>? title,
    Expression<String>? projectId,
    Expression<String>? deviceId,
    Expression<String>? cwd,
    Expression<String>? worktreePath,
    Expression<String>? agentId,
    Expression<String>? model,
    Expression<String>? syncState,
    Expression<String>? status,
    Expression<int>? lastActivityMs,
    Expression<int>? createdAtMs,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (title != null) 'title': title,
      if (projectId != null) 'project_id': projectId,
      if (deviceId != null) 'device_id': deviceId,
      if (cwd != null) 'cwd': cwd,
      if (worktreePath != null) 'worktree_path': worktreePath,
      if (agentId != null) 'agent_id': agentId,
      if (model != null) 'model': model,
      if (syncState != null) 'sync_state': syncState,
      if (status != null) 'status': status,
      if (lastActivityMs != null) 'last_activity_ms': lastActivityMs,
      if (createdAtMs != null) 'created_at_ms': createdAtMs,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ThreadsTableCompanion copyWith(
      {Value<String>? id,
      Value<String>? title,
      Value<String?>? projectId,
      Value<String?>? deviceId,
      Value<String?>? cwd,
      Value<String?>? worktreePath,
      Value<String>? agentId,
      Value<String?>? model,
      Value<String>? syncState,
      Value<String>? status,
      Value<int?>? lastActivityMs,
      Value<int>? createdAtMs,
      Value<int>? rowid}) {
    return ThreadsTableCompanion(
      id: id ?? this.id,
      title: title ?? this.title,
      projectId: projectId ?? this.projectId,
      deviceId: deviceId ?? this.deviceId,
      cwd: cwd ?? this.cwd,
      worktreePath: worktreePath ?? this.worktreePath,
      agentId: agentId ?? this.agentId,
      model: model ?? this.model,
      syncState: syncState ?? this.syncState,
      status: status ?? this.status,
      lastActivityMs: lastActivityMs ?? this.lastActivityMs,
      createdAtMs: createdAtMs ?? this.createdAtMs,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (title.present) {
      map['title'] = Variable<String>(title.value);
    }
    if (projectId.present) {
      map['project_id'] = Variable<String>(projectId.value);
    }
    if (deviceId.present) {
      map['device_id'] = Variable<String>(deviceId.value);
    }
    if (cwd.present) {
      map['cwd'] = Variable<String>(cwd.value);
    }
    if (worktreePath.present) {
      map['worktree_path'] = Variable<String>(worktreePath.value);
    }
    if (agentId.present) {
      map['agent_id'] = Variable<String>(agentId.value);
    }
    if (model.present) {
      map['model'] = Variable<String>(model.value);
    }
    if (syncState.present) {
      map['sync_state'] = Variable<String>(syncState.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (lastActivityMs.present) {
      map['last_activity_ms'] = Variable<int>(lastActivityMs.value);
    }
    if (createdAtMs.present) {
      map['created_at_ms'] = Variable<int>(createdAtMs.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ThreadsTableCompanion(')
          ..write('id: $id, ')
          ..write('title: $title, ')
          ..write('projectId: $projectId, ')
          ..write('deviceId: $deviceId, ')
          ..write('cwd: $cwd, ')
          ..write('worktreePath: $worktreePath, ')
          ..write('agentId: $agentId, ')
          ..write('model: $model, ')
          ..write('syncState: $syncState, ')
          ..write('status: $status, ')
          ..write('lastActivityMs: $lastActivityMs, ')
          ..write('createdAtMs: $createdAtMs, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $MessagesTableTable extends MessagesTable
    with TableInfo<$MessagesTableTable, MessageRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MessagesTableTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _threadIdMeta =
      const VerificationMeta('threadId');
  @override
  late final GeneratedColumn<String> threadId = GeneratedColumn<String>(
      'thread_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _turnIdMeta = const VerificationMeta('turnId');
  @override
  late final GeneratedColumn<String> turnId = GeneratedColumn<String>(
      'turn_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _roleMeta = const VerificationMeta('role');
  @override
  late final GeneratedColumn<String> role = GeneratedColumn<String>(
      'role', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _contentsJsonMeta =
      const VerificationMeta('contentsJson');
  @override
  late final GeneratedColumn<String> contentsJson = GeneratedColumn<String>(
      'contents_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _deliveryStateMeta =
      const VerificationMeta('deliveryState');
  @override
  late final GeneratedColumn<String> deliveryState = GeneratedColumn<String>(
      'delivery_state', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _orderIndexMeta =
      const VerificationMeta('orderIndex');
  @override
  late final GeneratedColumn<int> orderIndex = GeneratedColumn<int>(
      'order_index', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _fingerprintMeta =
      const VerificationMeta('fingerprint');
  @override
  late final GeneratedColumn<String> fingerprint = GeneratedColumn<String>(
      'fingerprint', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _createdAtMsMeta =
      const VerificationMeta('createdAtMs');
  @override
  late final GeneratedColumn<int> createdAtMs = GeneratedColumn<int>(
      'created_at_ms', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        threadId,
        turnId,
        role,
        contentsJson,
        deliveryState,
        orderIndex,
        fingerprint,
        createdAtMs
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'messages_table';
  @override
  VerificationContext validateIntegrity(Insertable<MessageRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('thread_id')) {
      context.handle(_threadIdMeta,
          threadId.isAcceptableOrUnknown(data['thread_id']!, _threadIdMeta));
    } else if (isInserting) {
      context.missing(_threadIdMeta);
    }
    if (data.containsKey('turn_id')) {
      context.handle(_turnIdMeta,
          turnId.isAcceptableOrUnknown(data['turn_id']!, _turnIdMeta));
    } else if (isInserting) {
      context.missing(_turnIdMeta);
    }
    if (data.containsKey('role')) {
      context.handle(
          _roleMeta, role.isAcceptableOrUnknown(data['role']!, _roleMeta));
    } else if (isInserting) {
      context.missing(_roleMeta);
    }
    if (data.containsKey('contents_json')) {
      context.handle(
          _contentsJsonMeta,
          contentsJson.isAcceptableOrUnknown(
              data['contents_json']!, _contentsJsonMeta));
    } else if (isInserting) {
      context.missing(_contentsJsonMeta);
    }
    if (data.containsKey('delivery_state')) {
      context.handle(
          _deliveryStateMeta,
          deliveryState.isAcceptableOrUnknown(
              data['delivery_state']!, _deliveryStateMeta));
    } else if (isInserting) {
      context.missing(_deliveryStateMeta);
    }
    if (data.containsKey('order_index')) {
      context.handle(
          _orderIndexMeta,
          orderIndex.isAcceptableOrUnknown(
              data['order_index']!, _orderIndexMeta));
    } else if (isInserting) {
      context.missing(_orderIndexMeta);
    }
    if (data.containsKey('fingerprint')) {
      context.handle(
          _fingerprintMeta,
          fingerprint.isAcceptableOrUnknown(
              data['fingerprint']!, _fingerprintMeta));
    }
    if (data.containsKey('created_at_ms')) {
      context.handle(
          _createdAtMsMeta,
          createdAtMs.isAcceptableOrUnknown(
              data['created_at_ms']!, _createdAtMsMeta));
    } else if (isInserting) {
      context.missing(_createdAtMsMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  MessageRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MessageRow(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      threadId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}thread_id'])!,
      turnId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}turn_id'])!,
      role: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}role'])!,
      contentsJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}contents_json'])!,
      deliveryState: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}delivery_state'])!,
      orderIndex: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}order_index'])!,
      fingerprint: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}fingerprint']),
      createdAtMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}created_at_ms'])!,
    );
  }

  @override
  $MessagesTableTable createAlias(String alias) {
    return $MessagesTableTable(attachedDatabase, alias);
  }
}

class MessageRow extends DataClass implements Insertable<MessageRow> {
  /// Unique message id (primary key).
  final String id;

  /// Owning thread id.
  final String threadId;

  /// Owning turn id.
  final String turnId;

  /// `MessageRole` serialized as its enum name.
  final String role;

  /// `List<MessageContent>` serialized as JSON.
  final String contentsJson;

  /// `MessageDeliveryState` serialized as its enum name.
  final String deliveryState;

  /// Monotonic ordering index within the thread.
  final int orderIndex;

  /// Content fingerprint used for deduplication, if computed.
  final String? fingerprint;

  /// Creation timestamp in epoch milliseconds.
  final int createdAtMs;
  const MessageRow(
      {required this.id,
      required this.threadId,
      required this.turnId,
      required this.role,
      required this.contentsJson,
      required this.deliveryState,
      required this.orderIndex,
      this.fingerprint,
      required this.createdAtMs});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['thread_id'] = Variable<String>(threadId);
    map['turn_id'] = Variable<String>(turnId);
    map['role'] = Variable<String>(role);
    map['contents_json'] = Variable<String>(contentsJson);
    map['delivery_state'] = Variable<String>(deliveryState);
    map['order_index'] = Variable<int>(orderIndex);
    if (!nullToAbsent || fingerprint != null) {
      map['fingerprint'] = Variable<String>(fingerprint);
    }
    map['created_at_ms'] = Variable<int>(createdAtMs);
    return map;
  }

  MessagesTableCompanion toCompanion(bool nullToAbsent) {
    return MessagesTableCompanion(
      id: Value(id),
      threadId: Value(threadId),
      turnId: Value(turnId),
      role: Value(role),
      contentsJson: Value(contentsJson),
      deliveryState: Value(deliveryState),
      orderIndex: Value(orderIndex),
      fingerprint: fingerprint == null && nullToAbsent
          ? const Value.absent()
          : Value(fingerprint),
      createdAtMs: Value(createdAtMs),
    );
  }

  factory MessageRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MessageRow(
      id: serializer.fromJson<String>(json['id']),
      threadId: serializer.fromJson<String>(json['threadId']),
      turnId: serializer.fromJson<String>(json['turnId']),
      role: serializer.fromJson<String>(json['role']),
      contentsJson: serializer.fromJson<String>(json['contentsJson']),
      deliveryState: serializer.fromJson<String>(json['deliveryState']),
      orderIndex: serializer.fromJson<int>(json['orderIndex']),
      fingerprint: serializer.fromJson<String?>(json['fingerprint']),
      createdAtMs: serializer.fromJson<int>(json['createdAtMs']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'threadId': serializer.toJson<String>(threadId),
      'turnId': serializer.toJson<String>(turnId),
      'role': serializer.toJson<String>(role),
      'contentsJson': serializer.toJson<String>(contentsJson),
      'deliveryState': serializer.toJson<String>(deliveryState),
      'orderIndex': serializer.toJson<int>(orderIndex),
      'fingerprint': serializer.toJson<String?>(fingerprint),
      'createdAtMs': serializer.toJson<int>(createdAtMs),
    };
  }

  MessageRow copyWith(
          {String? id,
          String? threadId,
          String? turnId,
          String? role,
          String? contentsJson,
          String? deliveryState,
          int? orderIndex,
          Value<String?> fingerprint = const Value.absent(),
          int? createdAtMs}) =>
      MessageRow(
        id: id ?? this.id,
        threadId: threadId ?? this.threadId,
        turnId: turnId ?? this.turnId,
        role: role ?? this.role,
        contentsJson: contentsJson ?? this.contentsJson,
        deliveryState: deliveryState ?? this.deliveryState,
        orderIndex: orderIndex ?? this.orderIndex,
        fingerprint: fingerprint.present ? fingerprint.value : this.fingerprint,
        createdAtMs: createdAtMs ?? this.createdAtMs,
      );
  MessageRow copyWithCompanion(MessagesTableCompanion data) {
    return MessageRow(
      id: data.id.present ? data.id.value : this.id,
      threadId: data.threadId.present ? data.threadId.value : this.threadId,
      turnId: data.turnId.present ? data.turnId.value : this.turnId,
      role: data.role.present ? data.role.value : this.role,
      contentsJson: data.contentsJson.present
          ? data.contentsJson.value
          : this.contentsJson,
      deliveryState: data.deliveryState.present
          ? data.deliveryState.value
          : this.deliveryState,
      orderIndex:
          data.orderIndex.present ? data.orderIndex.value : this.orderIndex,
      fingerprint:
          data.fingerprint.present ? data.fingerprint.value : this.fingerprint,
      createdAtMs:
          data.createdAtMs.present ? data.createdAtMs.value : this.createdAtMs,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MessageRow(')
          ..write('id: $id, ')
          ..write('threadId: $threadId, ')
          ..write('turnId: $turnId, ')
          ..write('role: $role, ')
          ..write('contentsJson: $contentsJson, ')
          ..write('deliveryState: $deliveryState, ')
          ..write('orderIndex: $orderIndex, ')
          ..write('fingerprint: $fingerprint, ')
          ..write('createdAtMs: $createdAtMs')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, threadId, turnId, role, contentsJson,
      deliveryState, orderIndex, fingerprint, createdAtMs);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MessageRow &&
          other.id == this.id &&
          other.threadId == this.threadId &&
          other.turnId == this.turnId &&
          other.role == this.role &&
          other.contentsJson == this.contentsJson &&
          other.deliveryState == this.deliveryState &&
          other.orderIndex == this.orderIndex &&
          other.fingerprint == this.fingerprint &&
          other.createdAtMs == this.createdAtMs);
}

class MessagesTableCompanion extends UpdateCompanion<MessageRow> {
  final Value<String> id;
  final Value<String> threadId;
  final Value<String> turnId;
  final Value<String> role;
  final Value<String> contentsJson;
  final Value<String> deliveryState;
  final Value<int> orderIndex;
  final Value<String?> fingerprint;
  final Value<int> createdAtMs;
  final Value<int> rowid;
  const MessagesTableCompanion({
    this.id = const Value.absent(),
    this.threadId = const Value.absent(),
    this.turnId = const Value.absent(),
    this.role = const Value.absent(),
    this.contentsJson = const Value.absent(),
    this.deliveryState = const Value.absent(),
    this.orderIndex = const Value.absent(),
    this.fingerprint = const Value.absent(),
    this.createdAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MessagesTableCompanion.insert({
    required String id,
    required String threadId,
    required String turnId,
    required String role,
    required String contentsJson,
    required String deliveryState,
    required int orderIndex,
    this.fingerprint = const Value.absent(),
    required int createdAtMs,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        threadId = Value(threadId),
        turnId = Value(turnId),
        role = Value(role),
        contentsJson = Value(contentsJson),
        deliveryState = Value(deliveryState),
        orderIndex = Value(orderIndex),
        createdAtMs = Value(createdAtMs);
  static Insertable<MessageRow> custom({
    Expression<String>? id,
    Expression<String>? threadId,
    Expression<String>? turnId,
    Expression<String>? role,
    Expression<String>? contentsJson,
    Expression<String>? deliveryState,
    Expression<int>? orderIndex,
    Expression<String>? fingerprint,
    Expression<int>? createdAtMs,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (threadId != null) 'thread_id': threadId,
      if (turnId != null) 'turn_id': turnId,
      if (role != null) 'role': role,
      if (contentsJson != null) 'contents_json': contentsJson,
      if (deliveryState != null) 'delivery_state': deliveryState,
      if (orderIndex != null) 'order_index': orderIndex,
      if (fingerprint != null) 'fingerprint': fingerprint,
      if (createdAtMs != null) 'created_at_ms': createdAtMs,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MessagesTableCompanion copyWith(
      {Value<String>? id,
      Value<String>? threadId,
      Value<String>? turnId,
      Value<String>? role,
      Value<String>? contentsJson,
      Value<String>? deliveryState,
      Value<int>? orderIndex,
      Value<String?>? fingerprint,
      Value<int>? createdAtMs,
      Value<int>? rowid}) {
    return MessagesTableCompanion(
      id: id ?? this.id,
      threadId: threadId ?? this.threadId,
      turnId: turnId ?? this.turnId,
      role: role ?? this.role,
      contentsJson: contentsJson ?? this.contentsJson,
      deliveryState: deliveryState ?? this.deliveryState,
      orderIndex: orderIndex ?? this.orderIndex,
      fingerprint: fingerprint ?? this.fingerprint,
      createdAtMs: createdAtMs ?? this.createdAtMs,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (threadId.present) {
      map['thread_id'] = Variable<String>(threadId.value);
    }
    if (turnId.present) {
      map['turn_id'] = Variable<String>(turnId.value);
    }
    if (role.present) {
      map['role'] = Variable<String>(role.value);
    }
    if (contentsJson.present) {
      map['contents_json'] = Variable<String>(contentsJson.value);
    }
    if (deliveryState.present) {
      map['delivery_state'] = Variable<String>(deliveryState.value);
    }
    if (orderIndex.present) {
      map['order_index'] = Variable<int>(orderIndex.value);
    }
    if (fingerprint.present) {
      map['fingerprint'] = Variable<String>(fingerprint.value);
    }
    if (createdAtMs.present) {
      map['created_at_ms'] = Variable<int>(createdAtMs.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MessagesTableCompanion(')
          ..write('id: $id, ')
          ..write('threadId: $threadId, ')
          ..write('turnId: $turnId, ')
          ..write('role: $role, ')
          ..write('contentsJson: $contentsJson, ')
          ..write('deliveryState: $deliveryState, ')
          ..write('orderIndex: $orderIndex, ')
          ..write('fingerprint: $fingerprint, ')
          ..write('createdAtMs: $createdAtMs, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $TurnsTableTable extends TurnsTable
    with TableInfo<$TurnsTableTable, TurnRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $TurnsTableTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _threadIdMeta =
      const VerificationMeta('threadId');
  @override
  late final GeneratedColumn<String> threadId = GeneratedColumn<String>(
      'thread_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
      'status', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _gitProgressJsonMeta =
      const VerificationMeta('gitProgressJson');
  @override
  late final GeneratedColumn<String> gitProgressJson = GeneratedColumn<String>(
      'git_progress_json', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _subagentStateJsonMeta =
      const VerificationMeta('subagentStateJson');
  @override
  late final GeneratedColumn<String> subagentStateJson =
      GeneratedColumn<String>('subagent_state_json', aliasedName, true,
          type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _planStateJsonMeta =
      const VerificationMeta('planStateJson');
  @override
  late final GeneratedColumn<String> planStateJson = GeneratedColumn<String>(
      'plan_state_json', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _startedAtMsMeta =
      const VerificationMeta('startedAtMs');
  @override
  late final GeneratedColumn<int> startedAtMs = GeneratedColumn<int>(
      'started_at_ms', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _completedAtMsMeta =
      const VerificationMeta('completedAtMs');
  @override
  late final GeneratedColumn<int> completedAtMs = GeneratedColumn<int>(
      'completed_at_ms', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        threadId,
        status,
        gitProgressJson,
        subagentStateJson,
        planStateJson,
        startedAtMs,
        completedAtMs
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'turns_table';
  @override
  VerificationContext validateIntegrity(Insertable<TurnRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('thread_id')) {
      context.handle(_threadIdMeta,
          threadId.isAcceptableOrUnknown(data['thread_id']!, _threadIdMeta));
    } else if (isInserting) {
      context.missing(_threadIdMeta);
    }
    if (data.containsKey('status')) {
      context.handle(_statusMeta,
          status.isAcceptableOrUnknown(data['status']!, _statusMeta));
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('git_progress_json')) {
      context.handle(
          _gitProgressJsonMeta,
          gitProgressJson.isAcceptableOrUnknown(
              data['git_progress_json']!, _gitProgressJsonMeta));
    }
    if (data.containsKey('subagent_state_json')) {
      context.handle(
          _subagentStateJsonMeta,
          subagentStateJson.isAcceptableOrUnknown(
              data['subagent_state_json']!, _subagentStateJsonMeta));
    }
    if (data.containsKey('plan_state_json')) {
      context.handle(
          _planStateJsonMeta,
          planStateJson.isAcceptableOrUnknown(
              data['plan_state_json']!, _planStateJsonMeta));
    }
    if (data.containsKey('started_at_ms')) {
      context.handle(
          _startedAtMsMeta,
          startedAtMs.isAcceptableOrUnknown(
              data['started_at_ms']!, _startedAtMsMeta));
    } else if (isInserting) {
      context.missing(_startedAtMsMeta);
    }
    if (data.containsKey('completed_at_ms')) {
      context.handle(
          _completedAtMsMeta,
          completedAtMs.isAcceptableOrUnknown(
              data['completed_at_ms']!, _completedAtMsMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  TurnRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return TurnRow(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      threadId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}thread_id'])!,
      status: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}status'])!,
      gitProgressJson: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}git_progress_json']),
      subagentStateJson: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}subagent_state_json']),
      planStateJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}plan_state_json']),
      startedAtMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}started_at_ms'])!,
      completedAtMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}completed_at_ms']),
    );
  }

  @override
  $TurnsTableTable createAlias(String alias) {
    return $TurnsTableTable(attachedDatabase, alias);
  }
}

class TurnRow extends DataClass implements Insertable<TurnRow> {
  /// Unique turn id (primary key).
  final String id;

  /// Owning thread id.
  final String threadId;

  /// `TurnStatus` serialized as its enum name.
  final String status;

  /// Git action progress serialized as JSON, if any.
  final String? gitProgressJson;

  /// Subagent state serialized as JSON, if any.
  final String? subagentStateJson;

  /// Plan-mode state serialized as JSON, if any.
  final String? planStateJson;

  /// Start timestamp in epoch milliseconds.
  final int startedAtMs;

  /// Completion timestamp in epoch milliseconds, if completed.
  final int? completedAtMs;
  const TurnRow(
      {required this.id,
      required this.threadId,
      required this.status,
      this.gitProgressJson,
      this.subagentStateJson,
      this.planStateJson,
      required this.startedAtMs,
      this.completedAtMs});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['thread_id'] = Variable<String>(threadId);
    map['status'] = Variable<String>(status);
    if (!nullToAbsent || gitProgressJson != null) {
      map['git_progress_json'] = Variable<String>(gitProgressJson);
    }
    if (!nullToAbsent || subagentStateJson != null) {
      map['subagent_state_json'] = Variable<String>(subagentStateJson);
    }
    if (!nullToAbsent || planStateJson != null) {
      map['plan_state_json'] = Variable<String>(planStateJson);
    }
    map['started_at_ms'] = Variable<int>(startedAtMs);
    if (!nullToAbsent || completedAtMs != null) {
      map['completed_at_ms'] = Variable<int>(completedAtMs);
    }
    return map;
  }

  TurnsTableCompanion toCompanion(bool nullToAbsent) {
    return TurnsTableCompanion(
      id: Value(id),
      threadId: Value(threadId),
      status: Value(status),
      gitProgressJson: gitProgressJson == null && nullToAbsent
          ? const Value.absent()
          : Value(gitProgressJson),
      subagentStateJson: subagentStateJson == null && nullToAbsent
          ? const Value.absent()
          : Value(subagentStateJson),
      planStateJson: planStateJson == null && nullToAbsent
          ? const Value.absent()
          : Value(planStateJson),
      startedAtMs: Value(startedAtMs),
      completedAtMs: completedAtMs == null && nullToAbsent
          ? const Value.absent()
          : Value(completedAtMs),
    );
  }

  factory TurnRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return TurnRow(
      id: serializer.fromJson<String>(json['id']),
      threadId: serializer.fromJson<String>(json['threadId']),
      status: serializer.fromJson<String>(json['status']),
      gitProgressJson: serializer.fromJson<String?>(json['gitProgressJson']),
      subagentStateJson:
          serializer.fromJson<String?>(json['subagentStateJson']),
      planStateJson: serializer.fromJson<String?>(json['planStateJson']),
      startedAtMs: serializer.fromJson<int>(json['startedAtMs']),
      completedAtMs: serializer.fromJson<int?>(json['completedAtMs']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'threadId': serializer.toJson<String>(threadId),
      'status': serializer.toJson<String>(status),
      'gitProgressJson': serializer.toJson<String?>(gitProgressJson),
      'subagentStateJson': serializer.toJson<String?>(subagentStateJson),
      'planStateJson': serializer.toJson<String?>(planStateJson),
      'startedAtMs': serializer.toJson<int>(startedAtMs),
      'completedAtMs': serializer.toJson<int?>(completedAtMs),
    };
  }

  TurnRow copyWith(
          {String? id,
          String? threadId,
          String? status,
          Value<String?> gitProgressJson = const Value.absent(),
          Value<String?> subagentStateJson = const Value.absent(),
          Value<String?> planStateJson = const Value.absent(),
          int? startedAtMs,
          Value<int?> completedAtMs = const Value.absent()}) =>
      TurnRow(
        id: id ?? this.id,
        threadId: threadId ?? this.threadId,
        status: status ?? this.status,
        gitProgressJson: gitProgressJson.present
            ? gitProgressJson.value
            : this.gitProgressJson,
        subagentStateJson: subagentStateJson.present
            ? subagentStateJson.value
            : this.subagentStateJson,
        planStateJson:
            planStateJson.present ? planStateJson.value : this.planStateJson,
        startedAtMs: startedAtMs ?? this.startedAtMs,
        completedAtMs:
            completedAtMs.present ? completedAtMs.value : this.completedAtMs,
      );
  TurnRow copyWithCompanion(TurnsTableCompanion data) {
    return TurnRow(
      id: data.id.present ? data.id.value : this.id,
      threadId: data.threadId.present ? data.threadId.value : this.threadId,
      status: data.status.present ? data.status.value : this.status,
      gitProgressJson: data.gitProgressJson.present
          ? data.gitProgressJson.value
          : this.gitProgressJson,
      subagentStateJson: data.subagentStateJson.present
          ? data.subagentStateJson.value
          : this.subagentStateJson,
      planStateJson: data.planStateJson.present
          ? data.planStateJson.value
          : this.planStateJson,
      startedAtMs:
          data.startedAtMs.present ? data.startedAtMs.value : this.startedAtMs,
      completedAtMs: data.completedAtMs.present
          ? data.completedAtMs.value
          : this.completedAtMs,
    );
  }

  @override
  String toString() {
    return (StringBuffer('TurnRow(')
          ..write('id: $id, ')
          ..write('threadId: $threadId, ')
          ..write('status: $status, ')
          ..write('gitProgressJson: $gitProgressJson, ')
          ..write('subagentStateJson: $subagentStateJson, ')
          ..write('planStateJson: $planStateJson, ')
          ..write('startedAtMs: $startedAtMs, ')
          ..write('completedAtMs: $completedAtMs')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, threadId, status, gitProgressJson,
      subagentStateJson, planStateJson, startedAtMs, completedAtMs);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TurnRow &&
          other.id == this.id &&
          other.threadId == this.threadId &&
          other.status == this.status &&
          other.gitProgressJson == this.gitProgressJson &&
          other.subagentStateJson == this.subagentStateJson &&
          other.planStateJson == this.planStateJson &&
          other.startedAtMs == this.startedAtMs &&
          other.completedAtMs == this.completedAtMs);
}

class TurnsTableCompanion extends UpdateCompanion<TurnRow> {
  final Value<String> id;
  final Value<String> threadId;
  final Value<String> status;
  final Value<String?> gitProgressJson;
  final Value<String?> subagentStateJson;
  final Value<String?> planStateJson;
  final Value<int> startedAtMs;
  final Value<int?> completedAtMs;
  final Value<int> rowid;
  const TurnsTableCompanion({
    this.id = const Value.absent(),
    this.threadId = const Value.absent(),
    this.status = const Value.absent(),
    this.gitProgressJson = const Value.absent(),
    this.subagentStateJson = const Value.absent(),
    this.planStateJson = const Value.absent(),
    this.startedAtMs = const Value.absent(),
    this.completedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  TurnsTableCompanion.insert({
    required String id,
    required String threadId,
    required String status,
    this.gitProgressJson = const Value.absent(),
    this.subagentStateJson = const Value.absent(),
    this.planStateJson = const Value.absent(),
    required int startedAtMs,
    this.completedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        threadId = Value(threadId),
        status = Value(status),
        startedAtMs = Value(startedAtMs);
  static Insertable<TurnRow> custom({
    Expression<String>? id,
    Expression<String>? threadId,
    Expression<String>? status,
    Expression<String>? gitProgressJson,
    Expression<String>? subagentStateJson,
    Expression<String>? planStateJson,
    Expression<int>? startedAtMs,
    Expression<int>? completedAtMs,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (threadId != null) 'thread_id': threadId,
      if (status != null) 'status': status,
      if (gitProgressJson != null) 'git_progress_json': gitProgressJson,
      if (subagentStateJson != null) 'subagent_state_json': subagentStateJson,
      if (planStateJson != null) 'plan_state_json': planStateJson,
      if (startedAtMs != null) 'started_at_ms': startedAtMs,
      if (completedAtMs != null) 'completed_at_ms': completedAtMs,
      if (rowid != null) 'rowid': rowid,
    });
  }

  TurnsTableCompanion copyWith(
      {Value<String>? id,
      Value<String>? threadId,
      Value<String>? status,
      Value<String?>? gitProgressJson,
      Value<String?>? subagentStateJson,
      Value<String?>? planStateJson,
      Value<int>? startedAtMs,
      Value<int?>? completedAtMs,
      Value<int>? rowid}) {
    return TurnsTableCompanion(
      id: id ?? this.id,
      threadId: threadId ?? this.threadId,
      status: status ?? this.status,
      gitProgressJson: gitProgressJson ?? this.gitProgressJson,
      subagentStateJson: subagentStateJson ?? this.subagentStateJson,
      planStateJson: planStateJson ?? this.planStateJson,
      startedAtMs: startedAtMs ?? this.startedAtMs,
      completedAtMs: completedAtMs ?? this.completedAtMs,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (threadId.present) {
      map['thread_id'] = Variable<String>(threadId.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (gitProgressJson.present) {
      map['git_progress_json'] = Variable<String>(gitProgressJson.value);
    }
    if (subagentStateJson.present) {
      map['subagent_state_json'] = Variable<String>(subagentStateJson.value);
    }
    if (planStateJson.present) {
      map['plan_state_json'] = Variable<String>(planStateJson.value);
    }
    if (startedAtMs.present) {
      map['started_at_ms'] = Variable<int>(startedAtMs.value);
    }
    if (completedAtMs.present) {
      map['completed_at_ms'] = Variable<int>(completedAtMs.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('TurnsTableCompanion(')
          ..write('id: $id, ')
          ..write('threadId: $threadId, ')
          ..write('status: $status, ')
          ..write('gitProgressJson: $gitProgressJson, ')
          ..write('subagentStateJson: $subagentStateJson, ')
          ..write('planStateJson: $planStateJson, ')
          ..write('startedAtMs: $startedAtMs, ')
          ..write('completedAtMs: $completedAtMs, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $ProjectsTableTable extends ProjectsTable
    with TableInfo<$ProjectsTableTable, ProjectRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ProjectsTableTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _displayNameMeta =
      const VerificationMeta('displayName');
  @override
  late final GeneratedColumn<String> displayName = GeneratedColumn<String>(
      'display_name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _cwdMeta = const VerificationMeta('cwd');
  @override
  late final GeneratedColumn<String> cwd = GeneratedColumn<String>(
      'cwd', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _agentIdMeta =
      const VerificationMeta('agentId');
  @override
  late final GeneratedColumn<String> agentId = GeneratedColumn<String>(
      'agent_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _agentConfigJsonMeta =
      const VerificationMeta('agentConfigJson');
  @override
  late final GeneratedColumn<String> agentConfigJson = GeneratedColumn<String>(
      'agent_config_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _lastActiveMsMeta =
      const VerificationMeta('lastActiveMs');
  @override
  late final GeneratedColumn<int> lastActiveMs = GeneratedColumn<int>(
      'last_active_ms', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns =>
      [id, displayName, cwd, agentId, agentConfigJson, lastActiveMs];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'projects_table';
  @override
  VerificationContext validateIntegrity(Insertable<ProjectRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('display_name')) {
      context.handle(
          _displayNameMeta,
          displayName.isAcceptableOrUnknown(
              data['display_name']!, _displayNameMeta));
    } else if (isInserting) {
      context.missing(_displayNameMeta);
    }
    if (data.containsKey('cwd')) {
      context.handle(
          _cwdMeta, cwd.isAcceptableOrUnknown(data['cwd']!, _cwdMeta));
    } else if (isInserting) {
      context.missing(_cwdMeta);
    }
    if (data.containsKey('agent_id')) {
      context.handle(_agentIdMeta,
          agentId.isAcceptableOrUnknown(data['agent_id']!, _agentIdMeta));
    } else if (isInserting) {
      context.missing(_agentIdMeta);
    }
    if (data.containsKey('agent_config_json')) {
      context.handle(
          _agentConfigJsonMeta,
          agentConfigJson.isAcceptableOrUnknown(
              data['agent_config_json']!, _agentConfigJsonMeta));
    } else if (isInserting) {
      context.missing(_agentConfigJsonMeta);
    }
    if (data.containsKey('last_active_ms')) {
      context.handle(
          _lastActiveMsMeta,
          lastActiveMs.isAcceptableOrUnknown(
              data['last_active_ms']!, _lastActiveMsMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  ProjectRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ProjectRow(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      displayName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}display_name'])!,
      cwd: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}cwd'])!,
      agentId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}agent_id'])!,
      agentConfigJson: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}agent_config_json'])!,
      lastActiveMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}last_active_ms']),
    );
  }

  @override
  $ProjectsTableTable createAlias(String alias) {
    return $ProjectsTableTable(attachedDatabase, alias);
  }
}

class ProjectRow extends DataClass implements Insertable<ProjectRow> {
  /// Unique project id (primary key).
  final String id;

  /// Human readable project name.
  final String displayName;

  /// Project working directory on the PC.
  final String cwd;

  /// Wire identifier of the configured agent.
  final String agentId;

  /// `AgentConfig` serialized as JSON.
  final String agentConfigJson;

  /// Last active timestamp in epoch milliseconds, if any.
  final int? lastActiveMs;
  const ProjectRow(
      {required this.id,
      required this.displayName,
      required this.cwd,
      required this.agentId,
      required this.agentConfigJson,
      this.lastActiveMs});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['display_name'] = Variable<String>(displayName);
    map['cwd'] = Variable<String>(cwd);
    map['agent_id'] = Variable<String>(agentId);
    map['agent_config_json'] = Variable<String>(agentConfigJson);
    if (!nullToAbsent || lastActiveMs != null) {
      map['last_active_ms'] = Variable<int>(lastActiveMs);
    }
    return map;
  }

  ProjectsTableCompanion toCompanion(bool nullToAbsent) {
    return ProjectsTableCompanion(
      id: Value(id),
      displayName: Value(displayName),
      cwd: Value(cwd),
      agentId: Value(agentId),
      agentConfigJson: Value(agentConfigJson),
      lastActiveMs: lastActiveMs == null && nullToAbsent
          ? const Value.absent()
          : Value(lastActiveMs),
    );
  }

  factory ProjectRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ProjectRow(
      id: serializer.fromJson<String>(json['id']),
      displayName: serializer.fromJson<String>(json['displayName']),
      cwd: serializer.fromJson<String>(json['cwd']),
      agentId: serializer.fromJson<String>(json['agentId']),
      agentConfigJson: serializer.fromJson<String>(json['agentConfigJson']),
      lastActiveMs: serializer.fromJson<int?>(json['lastActiveMs']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'displayName': serializer.toJson<String>(displayName),
      'cwd': serializer.toJson<String>(cwd),
      'agentId': serializer.toJson<String>(agentId),
      'agentConfigJson': serializer.toJson<String>(agentConfigJson),
      'lastActiveMs': serializer.toJson<int?>(lastActiveMs),
    };
  }

  ProjectRow copyWith(
          {String? id,
          String? displayName,
          String? cwd,
          String? agentId,
          String? agentConfigJson,
          Value<int?> lastActiveMs = const Value.absent()}) =>
      ProjectRow(
        id: id ?? this.id,
        displayName: displayName ?? this.displayName,
        cwd: cwd ?? this.cwd,
        agentId: agentId ?? this.agentId,
        agentConfigJson: agentConfigJson ?? this.agentConfigJson,
        lastActiveMs:
            lastActiveMs.present ? lastActiveMs.value : this.lastActiveMs,
      );
  ProjectRow copyWithCompanion(ProjectsTableCompanion data) {
    return ProjectRow(
      id: data.id.present ? data.id.value : this.id,
      displayName:
          data.displayName.present ? data.displayName.value : this.displayName,
      cwd: data.cwd.present ? data.cwd.value : this.cwd,
      agentId: data.agentId.present ? data.agentId.value : this.agentId,
      agentConfigJson: data.agentConfigJson.present
          ? data.agentConfigJson.value
          : this.agentConfigJson,
      lastActiveMs: data.lastActiveMs.present
          ? data.lastActiveMs.value
          : this.lastActiveMs,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ProjectRow(')
          ..write('id: $id, ')
          ..write('displayName: $displayName, ')
          ..write('cwd: $cwd, ')
          ..write('agentId: $agentId, ')
          ..write('agentConfigJson: $agentConfigJson, ')
          ..write('lastActiveMs: $lastActiveMs')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, displayName, cwd, agentId, agentConfigJson, lastActiveMs);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ProjectRow &&
          other.id == this.id &&
          other.displayName == this.displayName &&
          other.cwd == this.cwd &&
          other.agentId == this.agentId &&
          other.agentConfigJson == this.agentConfigJson &&
          other.lastActiveMs == this.lastActiveMs);
}

class ProjectsTableCompanion extends UpdateCompanion<ProjectRow> {
  final Value<String> id;
  final Value<String> displayName;
  final Value<String> cwd;
  final Value<String> agentId;
  final Value<String> agentConfigJson;
  final Value<int?> lastActiveMs;
  final Value<int> rowid;
  const ProjectsTableCompanion({
    this.id = const Value.absent(),
    this.displayName = const Value.absent(),
    this.cwd = const Value.absent(),
    this.agentId = const Value.absent(),
    this.agentConfigJson = const Value.absent(),
    this.lastActiveMs = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ProjectsTableCompanion.insert({
    required String id,
    required String displayName,
    required String cwd,
    required String agentId,
    required String agentConfigJson,
    this.lastActiveMs = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        displayName = Value(displayName),
        cwd = Value(cwd),
        agentId = Value(agentId),
        agentConfigJson = Value(agentConfigJson);
  static Insertable<ProjectRow> custom({
    Expression<String>? id,
    Expression<String>? displayName,
    Expression<String>? cwd,
    Expression<String>? agentId,
    Expression<String>? agentConfigJson,
    Expression<int>? lastActiveMs,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (displayName != null) 'display_name': displayName,
      if (cwd != null) 'cwd': cwd,
      if (agentId != null) 'agent_id': agentId,
      if (agentConfigJson != null) 'agent_config_json': agentConfigJson,
      if (lastActiveMs != null) 'last_active_ms': lastActiveMs,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ProjectsTableCompanion copyWith(
      {Value<String>? id,
      Value<String>? displayName,
      Value<String>? cwd,
      Value<String>? agentId,
      Value<String>? agentConfigJson,
      Value<int?>? lastActiveMs,
      Value<int>? rowid}) {
    return ProjectsTableCompanion(
      id: id ?? this.id,
      displayName: displayName ?? this.displayName,
      cwd: cwd ?? this.cwd,
      agentId: agentId ?? this.agentId,
      agentConfigJson: agentConfigJson ?? this.agentConfigJson,
      lastActiveMs: lastActiveMs ?? this.lastActiveMs,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (displayName.present) {
      map['display_name'] = Variable<String>(displayName.value);
    }
    if (cwd.present) {
      map['cwd'] = Variable<String>(cwd.value);
    }
    if (agentId.present) {
      map['agent_id'] = Variable<String>(agentId.value);
    }
    if (agentConfigJson.present) {
      map['agent_config_json'] = Variable<String>(agentConfigJson.value);
    }
    if (lastActiveMs.present) {
      map['last_active_ms'] = Variable<int>(lastActiveMs.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ProjectsTableCompanion(')
          ..write('id: $id, ')
          ..write('displayName: $displayName, ')
          ..write('cwd: $cwd, ')
          ..write('agentId: $agentId, ')
          ..write('agentConfigJson: $agentConfigJson, ')
          ..write('lastActiveMs: $lastActiveMs, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $TrustedDevicesTableTable extends TrustedDevicesTable
    with TableInfo<$TrustedDevicesTableTable, TrustedDeviceRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $TrustedDevicesTableTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _macDeviceIdMeta =
      const VerificationMeta('macDeviceId');
  @override
  late final GeneratedColumn<String> macDeviceId = GeneratedColumn<String>(
      'mac_device_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _displayNameMeta =
      const VerificationMeta('displayName');
  @override
  late final GeneratedColumn<String> displayName = GeneratedColumn<String>(
      'display_name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _relayUrlMeta =
      const VerificationMeta('relayUrl');
  @override
  late final GeneratedColumn<String> relayUrl = GeneratedColumn<String>(
      'relay_url', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _hostsMeta = const VerificationMeta('hosts');
  @override
  late final GeneratedColumn<String> hosts = GeneratedColumn<String>(
      'hosts', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _sessionIdMeta =
      const VerificationMeta('sessionId');
  @override
  late final GeneratedColumn<String> sessionId = GeneratedColumn<String>(
      'session_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _pairedAtMsMeta =
      const VerificationMeta('pairedAtMs');
  @override
  late final GeneratedColumn<int> pairedAtMs = GeneratedColumn<int>(
      'paired_at_ms', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _lastSeenMsMeta =
      const VerificationMeta('lastSeenMs');
  @override
  late final GeneratedColumn<int> lastSeenMs = GeneratedColumn<int>(
      'last_seen_ms', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _lastAppliedBridgeOutboundSeqMeta =
      const VerificationMeta('lastAppliedBridgeOutboundSeq');
  @override
  late final GeneratedColumn<int> lastAppliedBridgeOutboundSeq =
      GeneratedColumn<int>(
          'last_applied_bridge_outbound_seq', aliasedName, true,
          type: DriftSqlType.int, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [
        macDeviceId,
        displayName,
        relayUrl,
        hosts,
        sessionId,
        pairedAtMs,
        lastSeenMs,
        lastAppliedBridgeOutboundSeq
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'trusted_devices_table';
  @override
  VerificationContext validateIntegrity(Insertable<TrustedDeviceRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('mac_device_id')) {
      context.handle(
          _macDeviceIdMeta,
          macDeviceId.isAcceptableOrUnknown(
              data['mac_device_id']!, _macDeviceIdMeta));
    } else if (isInserting) {
      context.missing(_macDeviceIdMeta);
    }
    if (data.containsKey('display_name')) {
      context.handle(
          _displayNameMeta,
          displayName.isAcceptableOrUnknown(
              data['display_name']!, _displayNameMeta));
    } else if (isInserting) {
      context.missing(_displayNameMeta);
    }
    if (data.containsKey('relay_url')) {
      context.handle(_relayUrlMeta,
          relayUrl.isAcceptableOrUnknown(data['relay_url']!, _relayUrlMeta));
    } else if (isInserting) {
      context.missing(_relayUrlMeta);
    }
    if (data.containsKey('hosts')) {
      context.handle(
          _hostsMeta, hosts.isAcceptableOrUnknown(data['hosts']!, _hostsMeta));
    }
    if (data.containsKey('session_id')) {
      context.handle(_sessionIdMeta,
          sessionId.isAcceptableOrUnknown(data['session_id']!, _sessionIdMeta));
    } else if (isInserting) {
      context.missing(_sessionIdMeta);
    }
    if (data.containsKey('paired_at_ms')) {
      context.handle(
          _pairedAtMsMeta,
          pairedAtMs.isAcceptableOrUnknown(
              data['paired_at_ms']!, _pairedAtMsMeta));
    } else if (isInserting) {
      context.missing(_pairedAtMsMeta);
    }
    if (data.containsKey('last_seen_ms')) {
      context.handle(
          _lastSeenMsMeta,
          lastSeenMs.isAcceptableOrUnknown(
              data['last_seen_ms']!, _lastSeenMsMeta));
    }
    if (data.containsKey('last_applied_bridge_outbound_seq')) {
      context.handle(
          _lastAppliedBridgeOutboundSeqMeta,
          lastAppliedBridgeOutboundSeq.isAcceptableOrUnknown(
              data['last_applied_bridge_outbound_seq']!,
              _lastAppliedBridgeOutboundSeqMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {macDeviceId};
  @override
  TrustedDeviceRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return TrustedDeviceRow(
      macDeviceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}mac_device_id'])!,
      displayName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}display_name'])!,
      relayUrl: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}relay_url'])!,
      hosts: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}hosts']),
      sessionId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}session_id'])!,
      pairedAtMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}paired_at_ms'])!,
      lastSeenMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}last_seen_ms']),
      lastAppliedBridgeOutboundSeq: attachedDatabase.typeMapping.read(
          DriftSqlType.int,
          data['${effectivePrefix}last_applied_bridge_outbound_seq']),
    );
  }

  @override
  $TrustedDevicesTableTable createAlias(String alias) {
    return $TrustedDevicesTableTable(attachedDatabase, alias);
  }
}

class TrustedDeviceRow extends DataClass
    implements Insertable<TrustedDeviceRow> {
  /// Bridge device id (primary key).
  final String macDeviceId;

  /// Human readable device name.
  final String displayName;

  /// Relay URL used to reach the bridge (empty for a LAN/Tailscale-only device).
  final String relayUrl;

  /// Direct `host:port` addresses (LAN / Tailscale) advertised in the pairing
  /// QR, stored newline-separated. Nullable/absent for older rows (schema < 4).
  final String? hosts;

  /// Session id established during pairing.
  final String sessionId;

  /// Pairing timestamp in epoch milliseconds.
  final int pairedAtMs;

  /// Last seen timestamp in epoch milliseconds, if any.
  final int? lastSeenMs;

  /// Highest bridge→phone `seq` this phone has applied for this device, sent on
  /// reconnect as `clientHello.resumeState.lastAppliedBridgeOutboundSeq` so the
  /// bridge replays only what was missed (spec 02a §5.9.2). Nullable/absent for
  /// older rows (schema < 5); treated as 0.
  final int? lastAppliedBridgeOutboundSeq;
  const TrustedDeviceRow(
      {required this.macDeviceId,
      required this.displayName,
      required this.relayUrl,
      this.hosts,
      required this.sessionId,
      required this.pairedAtMs,
      this.lastSeenMs,
      this.lastAppliedBridgeOutboundSeq});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['mac_device_id'] = Variable<String>(macDeviceId);
    map['display_name'] = Variable<String>(displayName);
    map['relay_url'] = Variable<String>(relayUrl);
    if (!nullToAbsent || hosts != null) {
      map['hosts'] = Variable<String>(hosts);
    }
    map['session_id'] = Variable<String>(sessionId);
    map['paired_at_ms'] = Variable<int>(pairedAtMs);
    if (!nullToAbsent || lastSeenMs != null) {
      map['last_seen_ms'] = Variable<int>(lastSeenMs);
    }
    if (!nullToAbsent || lastAppliedBridgeOutboundSeq != null) {
      map['last_applied_bridge_outbound_seq'] =
          Variable<int>(lastAppliedBridgeOutboundSeq);
    }
    return map;
  }

  TrustedDevicesTableCompanion toCompanion(bool nullToAbsent) {
    return TrustedDevicesTableCompanion(
      macDeviceId: Value(macDeviceId),
      displayName: Value(displayName),
      relayUrl: Value(relayUrl),
      hosts:
          hosts == null && nullToAbsent ? const Value.absent() : Value(hosts),
      sessionId: Value(sessionId),
      pairedAtMs: Value(pairedAtMs),
      lastSeenMs: lastSeenMs == null && nullToAbsent
          ? const Value.absent()
          : Value(lastSeenMs),
      lastAppliedBridgeOutboundSeq:
          lastAppliedBridgeOutboundSeq == null && nullToAbsent
              ? const Value.absent()
              : Value(lastAppliedBridgeOutboundSeq),
    );
  }

  factory TrustedDeviceRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return TrustedDeviceRow(
      macDeviceId: serializer.fromJson<String>(json['macDeviceId']),
      displayName: serializer.fromJson<String>(json['displayName']),
      relayUrl: serializer.fromJson<String>(json['relayUrl']),
      hosts: serializer.fromJson<String?>(json['hosts']),
      sessionId: serializer.fromJson<String>(json['sessionId']),
      pairedAtMs: serializer.fromJson<int>(json['pairedAtMs']),
      lastSeenMs: serializer.fromJson<int?>(json['lastSeenMs']),
      lastAppliedBridgeOutboundSeq:
          serializer.fromJson<int?>(json['lastAppliedBridgeOutboundSeq']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'macDeviceId': serializer.toJson<String>(macDeviceId),
      'displayName': serializer.toJson<String>(displayName),
      'relayUrl': serializer.toJson<String>(relayUrl),
      'hosts': serializer.toJson<String?>(hosts),
      'sessionId': serializer.toJson<String>(sessionId),
      'pairedAtMs': serializer.toJson<int>(pairedAtMs),
      'lastSeenMs': serializer.toJson<int?>(lastSeenMs),
      'lastAppliedBridgeOutboundSeq':
          serializer.toJson<int?>(lastAppliedBridgeOutboundSeq),
    };
  }

  TrustedDeviceRow copyWith(
          {String? macDeviceId,
          String? displayName,
          String? relayUrl,
          Value<String?> hosts = const Value.absent(),
          String? sessionId,
          int? pairedAtMs,
          Value<int?> lastSeenMs = const Value.absent(),
          Value<int?> lastAppliedBridgeOutboundSeq = const Value.absent()}) =>
      TrustedDeviceRow(
        macDeviceId: macDeviceId ?? this.macDeviceId,
        displayName: displayName ?? this.displayName,
        relayUrl: relayUrl ?? this.relayUrl,
        hosts: hosts.present ? hosts.value : this.hosts,
        sessionId: sessionId ?? this.sessionId,
        pairedAtMs: pairedAtMs ?? this.pairedAtMs,
        lastSeenMs: lastSeenMs.present ? lastSeenMs.value : this.lastSeenMs,
        lastAppliedBridgeOutboundSeq: lastAppliedBridgeOutboundSeq.present
            ? lastAppliedBridgeOutboundSeq.value
            : this.lastAppliedBridgeOutboundSeq,
      );
  TrustedDeviceRow copyWithCompanion(TrustedDevicesTableCompanion data) {
    return TrustedDeviceRow(
      macDeviceId:
          data.macDeviceId.present ? data.macDeviceId.value : this.macDeviceId,
      displayName:
          data.displayName.present ? data.displayName.value : this.displayName,
      relayUrl: data.relayUrl.present ? data.relayUrl.value : this.relayUrl,
      hosts: data.hosts.present ? data.hosts.value : this.hosts,
      sessionId: data.sessionId.present ? data.sessionId.value : this.sessionId,
      pairedAtMs:
          data.pairedAtMs.present ? data.pairedAtMs.value : this.pairedAtMs,
      lastSeenMs:
          data.lastSeenMs.present ? data.lastSeenMs.value : this.lastSeenMs,
      lastAppliedBridgeOutboundSeq: data.lastAppliedBridgeOutboundSeq.present
          ? data.lastAppliedBridgeOutboundSeq.value
          : this.lastAppliedBridgeOutboundSeq,
    );
  }

  @override
  String toString() {
    return (StringBuffer('TrustedDeviceRow(')
          ..write('macDeviceId: $macDeviceId, ')
          ..write('displayName: $displayName, ')
          ..write('relayUrl: $relayUrl, ')
          ..write('hosts: $hosts, ')
          ..write('sessionId: $sessionId, ')
          ..write('pairedAtMs: $pairedAtMs, ')
          ..write('lastSeenMs: $lastSeenMs, ')
          ..write('lastAppliedBridgeOutboundSeq: $lastAppliedBridgeOutboundSeq')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(macDeviceId, displayName, relayUrl, hosts,
      sessionId, pairedAtMs, lastSeenMs, lastAppliedBridgeOutboundSeq);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TrustedDeviceRow &&
          other.macDeviceId == this.macDeviceId &&
          other.displayName == this.displayName &&
          other.relayUrl == this.relayUrl &&
          other.hosts == this.hosts &&
          other.sessionId == this.sessionId &&
          other.pairedAtMs == this.pairedAtMs &&
          other.lastSeenMs == this.lastSeenMs &&
          other.lastAppliedBridgeOutboundSeq ==
              this.lastAppliedBridgeOutboundSeq);
}

class TrustedDevicesTableCompanion extends UpdateCompanion<TrustedDeviceRow> {
  final Value<String> macDeviceId;
  final Value<String> displayName;
  final Value<String> relayUrl;
  final Value<String?> hosts;
  final Value<String> sessionId;
  final Value<int> pairedAtMs;
  final Value<int?> lastSeenMs;
  final Value<int?> lastAppliedBridgeOutboundSeq;
  final Value<int> rowid;
  const TrustedDevicesTableCompanion({
    this.macDeviceId = const Value.absent(),
    this.displayName = const Value.absent(),
    this.relayUrl = const Value.absent(),
    this.hosts = const Value.absent(),
    this.sessionId = const Value.absent(),
    this.pairedAtMs = const Value.absent(),
    this.lastSeenMs = const Value.absent(),
    this.lastAppliedBridgeOutboundSeq = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  TrustedDevicesTableCompanion.insert({
    required String macDeviceId,
    required String displayName,
    required String relayUrl,
    this.hosts = const Value.absent(),
    required String sessionId,
    required int pairedAtMs,
    this.lastSeenMs = const Value.absent(),
    this.lastAppliedBridgeOutboundSeq = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : macDeviceId = Value(macDeviceId),
        displayName = Value(displayName),
        relayUrl = Value(relayUrl),
        sessionId = Value(sessionId),
        pairedAtMs = Value(pairedAtMs);
  static Insertable<TrustedDeviceRow> custom({
    Expression<String>? macDeviceId,
    Expression<String>? displayName,
    Expression<String>? relayUrl,
    Expression<String>? hosts,
    Expression<String>? sessionId,
    Expression<int>? pairedAtMs,
    Expression<int>? lastSeenMs,
    Expression<int>? lastAppliedBridgeOutboundSeq,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (macDeviceId != null) 'mac_device_id': macDeviceId,
      if (displayName != null) 'display_name': displayName,
      if (relayUrl != null) 'relay_url': relayUrl,
      if (hosts != null) 'hosts': hosts,
      if (sessionId != null) 'session_id': sessionId,
      if (pairedAtMs != null) 'paired_at_ms': pairedAtMs,
      if (lastSeenMs != null) 'last_seen_ms': lastSeenMs,
      if (lastAppliedBridgeOutboundSeq != null)
        'last_applied_bridge_outbound_seq': lastAppliedBridgeOutboundSeq,
      if (rowid != null) 'rowid': rowid,
    });
  }

  TrustedDevicesTableCompanion copyWith(
      {Value<String>? macDeviceId,
      Value<String>? displayName,
      Value<String>? relayUrl,
      Value<String?>? hosts,
      Value<String>? sessionId,
      Value<int>? pairedAtMs,
      Value<int?>? lastSeenMs,
      Value<int?>? lastAppliedBridgeOutboundSeq,
      Value<int>? rowid}) {
    return TrustedDevicesTableCompanion(
      macDeviceId: macDeviceId ?? this.macDeviceId,
      displayName: displayName ?? this.displayName,
      relayUrl: relayUrl ?? this.relayUrl,
      hosts: hosts ?? this.hosts,
      sessionId: sessionId ?? this.sessionId,
      pairedAtMs: pairedAtMs ?? this.pairedAtMs,
      lastSeenMs: lastSeenMs ?? this.lastSeenMs,
      lastAppliedBridgeOutboundSeq:
          lastAppliedBridgeOutboundSeq ?? this.lastAppliedBridgeOutboundSeq,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (macDeviceId.present) {
      map['mac_device_id'] = Variable<String>(macDeviceId.value);
    }
    if (displayName.present) {
      map['display_name'] = Variable<String>(displayName.value);
    }
    if (relayUrl.present) {
      map['relay_url'] = Variable<String>(relayUrl.value);
    }
    if (hosts.present) {
      map['hosts'] = Variable<String>(hosts.value);
    }
    if (sessionId.present) {
      map['session_id'] = Variable<String>(sessionId.value);
    }
    if (pairedAtMs.present) {
      map['paired_at_ms'] = Variable<int>(pairedAtMs.value);
    }
    if (lastSeenMs.present) {
      map['last_seen_ms'] = Variable<int>(lastSeenMs.value);
    }
    if (lastAppliedBridgeOutboundSeq.present) {
      map['last_applied_bridge_outbound_seq'] =
          Variable<int>(lastAppliedBridgeOutboundSeq.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('TrustedDevicesTableCompanion(')
          ..write('macDeviceId: $macDeviceId, ')
          ..write('displayName: $displayName, ')
          ..write('relayUrl: $relayUrl, ')
          ..write('hosts: $hosts, ')
          ..write('sessionId: $sessionId, ')
          ..write('pairedAtMs: $pairedAtMs, ')
          ..write('lastSeenMs: $lastSeenMs, ')
          ..write(
              'lastAppliedBridgeOutboundSeq: $lastAppliedBridgeOutboundSeq, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $ComposerDraftsTableTable extends ComposerDraftsTable
    with TableInfo<$ComposerDraftsTableTable, ComposerDraftRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ComposerDraftsTableTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _threadIdMeta =
      const VerificationMeta('threadId');
  @override
  late final GeneratedColumn<String> threadId = GeneratedColumn<String>(
      'thread_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _draftMeta = const VerificationMeta('draft');
  @override
  late final GeneratedColumn<String> draft = GeneratedColumn<String>(
      'draft', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _updatedAtMsMeta =
      const VerificationMeta('updatedAtMs');
  @override
  late final GeneratedColumn<int> updatedAtMs = GeneratedColumn<int>(
      'updated_at_ms', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [threadId, draft, updatedAtMs];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'composer_drafts_table';
  @override
  VerificationContext validateIntegrity(Insertable<ComposerDraftRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('thread_id')) {
      context.handle(_threadIdMeta,
          threadId.isAcceptableOrUnknown(data['thread_id']!, _threadIdMeta));
    } else if (isInserting) {
      context.missing(_threadIdMeta);
    }
    if (data.containsKey('draft')) {
      context.handle(
          _draftMeta, draft.isAcceptableOrUnknown(data['draft']!, _draftMeta));
    } else if (isInserting) {
      context.missing(_draftMeta);
    }
    if (data.containsKey('updated_at_ms')) {
      context.handle(
          _updatedAtMsMeta,
          updatedAtMs.isAcceptableOrUnknown(
              data['updated_at_ms']!, _updatedAtMsMeta));
    } else if (isInserting) {
      context.missing(_updatedAtMsMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {threadId};
  @override
  ComposerDraftRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ComposerDraftRow(
      threadId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}thread_id'])!,
      draft: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}draft'])!,
      updatedAtMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}updated_at_ms'])!,
    );
  }

  @override
  $ComposerDraftsTableTable createAlias(String alias) {
    return $ComposerDraftsTableTable(attachedDatabase, alias);
  }
}

class ComposerDraftRow extends DataClass
    implements Insertable<ComposerDraftRow> {
  /// Owning thread id (primary key — one draft per thread).
  final String threadId;

  /// The draft text.
  final String draft;

  /// Last update timestamp in epoch milliseconds.
  final int updatedAtMs;
  const ComposerDraftRow(
      {required this.threadId, required this.draft, required this.updatedAtMs});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['thread_id'] = Variable<String>(threadId);
    map['draft'] = Variable<String>(draft);
    map['updated_at_ms'] = Variable<int>(updatedAtMs);
    return map;
  }

  ComposerDraftsTableCompanion toCompanion(bool nullToAbsent) {
    return ComposerDraftsTableCompanion(
      threadId: Value(threadId),
      draft: Value(draft),
      updatedAtMs: Value(updatedAtMs),
    );
  }

  factory ComposerDraftRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ComposerDraftRow(
      threadId: serializer.fromJson<String>(json['threadId']),
      draft: serializer.fromJson<String>(json['draft']),
      updatedAtMs: serializer.fromJson<int>(json['updatedAtMs']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'threadId': serializer.toJson<String>(threadId),
      'draft': serializer.toJson<String>(draft),
      'updatedAtMs': serializer.toJson<int>(updatedAtMs),
    };
  }

  ComposerDraftRow copyWith(
          {String? threadId, String? draft, int? updatedAtMs}) =>
      ComposerDraftRow(
        threadId: threadId ?? this.threadId,
        draft: draft ?? this.draft,
        updatedAtMs: updatedAtMs ?? this.updatedAtMs,
      );
  ComposerDraftRow copyWithCompanion(ComposerDraftsTableCompanion data) {
    return ComposerDraftRow(
      threadId: data.threadId.present ? data.threadId.value : this.threadId,
      draft: data.draft.present ? data.draft.value : this.draft,
      updatedAtMs:
          data.updatedAtMs.present ? data.updatedAtMs.value : this.updatedAtMs,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ComposerDraftRow(')
          ..write('threadId: $threadId, ')
          ..write('draft: $draft, ')
          ..write('updatedAtMs: $updatedAtMs')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(threadId, draft, updatedAtMs);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ComposerDraftRow &&
          other.threadId == this.threadId &&
          other.draft == this.draft &&
          other.updatedAtMs == this.updatedAtMs);
}

class ComposerDraftsTableCompanion extends UpdateCompanion<ComposerDraftRow> {
  final Value<String> threadId;
  final Value<String> draft;
  final Value<int> updatedAtMs;
  final Value<int> rowid;
  const ComposerDraftsTableCompanion({
    this.threadId = const Value.absent(),
    this.draft = const Value.absent(),
    this.updatedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ComposerDraftsTableCompanion.insert({
    required String threadId,
    required String draft,
    required int updatedAtMs,
    this.rowid = const Value.absent(),
  })  : threadId = Value(threadId),
        draft = Value(draft),
        updatedAtMs = Value(updatedAtMs);
  static Insertable<ComposerDraftRow> custom({
    Expression<String>? threadId,
    Expression<String>? draft,
    Expression<int>? updatedAtMs,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (threadId != null) 'thread_id': threadId,
      if (draft != null) 'draft': draft,
      if (updatedAtMs != null) 'updated_at_ms': updatedAtMs,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ComposerDraftsTableCompanion copyWith(
      {Value<String>? threadId,
      Value<String>? draft,
      Value<int>? updatedAtMs,
      Value<int>? rowid}) {
    return ComposerDraftsTableCompanion(
      threadId: threadId ?? this.threadId,
      draft: draft ?? this.draft,
      updatedAtMs: updatedAtMs ?? this.updatedAtMs,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (threadId.present) {
      map['thread_id'] = Variable<String>(threadId.value);
    }
    if (draft.present) {
      map['draft'] = Variable<String>(draft.value);
    }
    if (updatedAtMs.present) {
      map['updated_at_ms'] = Variable<int>(updatedAtMs.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ComposerDraftsTableCompanion(')
          ..write('threadId: $threadId, ')
          ..write('draft: $draft, ')
          ..write('updatedAtMs: $updatedAtMs, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $GitActionLogTableTable extends GitActionLogTable
    with TableInfo<$GitActionLogTableTable, GitActionLogRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $GitActionLogTableTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _threadIdMeta =
      const VerificationMeta('threadId');
  @override
  late final GeneratedColumn<String> threadId = GeneratedColumn<String>(
      'thread_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
      'kind', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
      'status', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _paramsJsonMeta =
      const VerificationMeta('paramsJson');
  @override
  late final GeneratedColumn<String> paramsJson = GeneratedColumn<String>(
      'params_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _resultJsonMeta =
      const VerificationMeta('resultJson');
  @override
  late final GeneratedColumn<String> resultJson = GeneratedColumn<String>(
      'result_json', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _errorMessageMeta =
      const VerificationMeta('errorMessage');
  @override
  late final GeneratedColumn<String> errorMessage = GeneratedColumn<String>(
      'error_message', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _startedAtMsMeta =
      const VerificationMeta('startedAtMs');
  @override
  late final GeneratedColumn<int> startedAtMs = GeneratedColumn<int>(
      'started_at_ms', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _completedAtMsMeta =
      const VerificationMeta('completedAtMs');
  @override
  late final GeneratedColumn<int> completedAtMs = GeneratedColumn<int>(
      'completed_at_ms', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        threadId,
        kind,
        status,
        paramsJson,
        resultJson,
        errorMessage,
        startedAtMs,
        completedAtMs
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'git_action_log_table';
  @override
  VerificationContext validateIntegrity(Insertable<GitActionLogRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('thread_id')) {
      context.handle(_threadIdMeta,
          threadId.isAcceptableOrUnknown(data['thread_id']!, _threadIdMeta));
    } else if (isInserting) {
      context.missing(_threadIdMeta);
    }
    if (data.containsKey('kind')) {
      context.handle(
          _kindMeta, kind.isAcceptableOrUnknown(data['kind']!, _kindMeta));
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('status')) {
      context.handle(_statusMeta,
          status.isAcceptableOrUnknown(data['status']!, _statusMeta));
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('params_json')) {
      context.handle(
          _paramsJsonMeta,
          paramsJson.isAcceptableOrUnknown(
              data['params_json']!, _paramsJsonMeta));
    } else if (isInserting) {
      context.missing(_paramsJsonMeta);
    }
    if (data.containsKey('result_json')) {
      context.handle(
          _resultJsonMeta,
          resultJson.isAcceptableOrUnknown(
              data['result_json']!, _resultJsonMeta));
    }
    if (data.containsKey('error_message')) {
      context.handle(
          _errorMessageMeta,
          errorMessage.isAcceptableOrUnknown(
              data['error_message']!, _errorMessageMeta));
    }
    if (data.containsKey('started_at_ms')) {
      context.handle(
          _startedAtMsMeta,
          startedAtMs.isAcceptableOrUnknown(
              data['started_at_ms']!, _startedAtMsMeta));
    } else if (isInserting) {
      context.missing(_startedAtMsMeta);
    }
    if (data.containsKey('completed_at_ms')) {
      context.handle(
          _completedAtMsMeta,
          completedAtMs.isAcceptableOrUnknown(
              data['completed_at_ms']!, _completedAtMsMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  GitActionLogRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return GitActionLogRow(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      threadId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}thread_id'])!,
      kind: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}kind'])!,
      status: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}status'])!,
      paramsJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}params_json'])!,
      resultJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}result_json']),
      errorMessage: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}error_message']),
      startedAtMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}started_at_ms'])!,
      completedAtMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}completed_at_ms']),
    );
  }

  @override
  $GitActionLogTableTable createAlias(String alias) {
    return $GitActionLogTableTable(attachedDatabase, alias);
  }
}

class GitActionLogRow extends DataClass implements Insertable<GitActionLogRow> {
  /// Unique log entry id (primary key).
  final String id;

  /// Owning thread id.
  final String threadId;

  /// `GitActionKind` serialized as its enum name.
  final String kind;

  /// Outcome status (`completed` or `error`).
  final String status;

  /// Action parameters serialized as JSON.
  final String paramsJson;

  /// Action result serialized as JSON, if successful.
  final String? resultJson;

  /// Error message, if the action failed.
  final String? errorMessage;

  /// Start timestamp in epoch milliseconds.
  final int startedAtMs;

  /// Completion timestamp in epoch milliseconds, if completed.
  final int? completedAtMs;
  const GitActionLogRow(
      {required this.id,
      required this.threadId,
      required this.kind,
      required this.status,
      required this.paramsJson,
      this.resultJson,
      this.errorMessage,
      required this.startedAtMs,
      this.completedAtMs});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['thread_id'] = Variable<String>(threadId);
    map['kind'] = Variable<String>(kind);
    map['status'] = Variable<String>(status);
    map['params_json'] = Variable<String>(paramsJson);
    if (!nullToAbsent || resultJson != null) {
      map['result_json'] = Variable<String>(resultJson);
    }
    if (!nullToAbsent || errorMessage != null) {
      map['error_message'] = Variable<String>(errorMessage);
    }
    map['started_at_ms'] = Variable<int>(startedAtMs);
    if (!nullToAbsent || completedAtMs != null) {
      map['completed_at_ms'] = Variable<int>(completedAtMs);
    }
    return map;
  }

  GitActionLogTableCompanion toCompanion(bool nullToAbsent) {
    return GitActionLogTableCompanion(
      id: Value(id),
      threadId: Value(threadId),
      kind: Value(kind),
      status: Value(status),
      paramsJson: Value(paramsJson),
      resultJson: resultJson == null && nullToAbsent
          ? const Value.absent()
          : Value(resultJson),
      errorMessage: errorMessage == null && nullToAbsent
          ? const Value.absent()
          : Value(errorMessage),
      startedAtMs: Value(startedAtMs),
      completedAtMs: completedAtMs == null && nullToAbsent
          ? const Value.absent()
          : Value(completedAtMs),
    );
  }

  factory GitActionLogRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return GitActionLogRow(
      id: serializer.fromJson<String>(json['id']),
      threadId: serializer.fromJson<String>(json['threadId']),
      kind: serializer.fromJson<String>(json['kind']),
      status: serializer.fromJson<String>(json['status']),
      paramsJson: serializer.fromJson<String>(json['paramsJson']),
      resultJson: serializer.fromJson<String?>(json['resultJson']),
      errorMessage: serializer.fromJson<String?>(json['errorMessage']),
      startedAtMs: serializer.fromJson<int>(json['startedAtMs']),
      completedAtMs: serializer.fromJson<int?>(json['completedAtMs']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'threadId': serializer.toJson<String>(threadId),
      'kind': serializer.toJson<String>(kind),
      'status': serializer.toJson<String>(status),
      'paramsJson': serializer.toJson<String>(paramsJson),
      'resultJson': serializer.toJson<String?>(resultJson),
      'errorMessage': serializer.toJson<String?>(errorMessage),
      'startedAtMs': serializer.toJson<int>(startedAtMs),
      'completedAtMs': serializer.toJson<int?>(completedAtMs),
    };
  }

  GitActionLogRow copyWith(
          {String? id,
          String? threadId,
          String? kind,
          String? status,
          String? paramsJson,
          Value<String?> resultJson = const Value.absent(),
          Value<String?> errorMessage = const Value.absent(),
          int? startedAtMs,
          Value<int?> completedAtMs = const Value.absent()}) =>
      GitActionLogRow(
        id: id ?? this.id,
        threadId: threadId ?? this.threadId,
        kind: kind ?? this.kind,
        status: status ?? this.status,
        paramsJson: paramsJson ?? this.paramsJson,
        resultJson: resultJson.present ? resultJson.value : this.resultJson,
        errorMessage:
            errorMessage.present ? errorMessage.value : this.errorMessage,
        startedAtMs: startedAtMs ?? this.startedAtMs,
        completedAtMs:
            completedAtMs.present ? completedAtMs.value : this.completedAtMs,
      );
  GitActionLogRow copyWithCompanion(GitActionLogTableCompanion data) {
    return GitActionLogRow(
      id: data.id.present ? data.id.value : this.id,
      threadId: data.threadId.present ? data.threadId.value : this.threadId,
      kind: data.kind.present ? data.kind.value : this.kind,
      status: data.status.present ? data.status.value : this.status,
      paramsJson:
          data.paramsJson.present ? data.paramsJson.value : this.paramsJson,
      resultJson:
          data.resultJson.present ? data.resultJson.value : this.resultJson,
      errorMessage: data.errorMessage.present
          ? data.errorMessage.value
          : this.errorMessage,
      startedAtMs:
          data.startedAtMs.present ? data.startedAtMs.value : this.startedAtMs,
      completedAtMs: data.completedAtMs.present
          ? data.completedAtMs.value
          : this.completedAtMs,
    );
  }

  @override
  String toString() {
    return (StringBuffer('GitActionLogRow(')
          ..write('id: $id, ')
          ..write('threadId: $threadId, ')
          ..write('kind: $kind, ')
          ..write('status: $status, ')
          ..write('paramsJson: $paramsJson, ')
          ..write('resultJson: $resultJson, ')
          ..write('errorMessage: $errorMessage, ')
          ..write('startedAtMs: $startedAtMs, ')
          ..write('completedAtMs: $completedAtMs')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, threadId, kind, status, paramsJson,
      resultJson, errorMessage, startedAtMs, completedAtMs);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is GitActionLogRow &&
          other.id == this.id &&
          other.threadId == this.threadId &&
          other.kind == this.kind &&
          other.status == this.status &&
          other.paramsJson == this.paramsJson &&
          other.resultJson == this.resultJson &&
          other.errorMessage == this.errorMessage &&
          other.startedAtMs == this.startedAtMs &&
          other.completedAtMs == this.completedAtMs);
}

class GitActionLogTableCompanion extends UpdateCompanion<GitActionLogRow> {
  final Value<String> id;
  final Value<String> threadId;
  final Value<String> kind;
  final Value<String> status;
  final Value<String> paramsJson;
  final Value<String?> resultJson;
  final Value<String?> errorMessage;
  final Value<int> startedAtMs;
  final Value<int?> completedAtMs;
  final Value<int> rowid;
  const GitActionLogTableCompanion({
    this.id = const Value.absent(),
    this.threadId = const Value.absent(),
    this.kind = const Value.absent(),
    this.status = const Value.absent(),
    this.paramsJson = const Value.absent(),
    this.resultJson = const Value.absent(),
    this.errorMessage = const Value.absent(),
    this.startedAtMs = const Value.absent(),
    this.completedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  GitActionLogTableCompanion.insert({
    required String id,
    required String threadId,
    required String kind,
    required String status,
    required String paramsJson,
    this.resultJson = const Value.absent(),
    this.errorMessage = const Value.absent(),
    required int startedAtMs,
    this.completedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        threadId = Value(threadId),
        kind = Value(kind),
        status = Value(status),
        paramsJson = Value(paramsJson),
        startedAtMs = Value(startedAtMs);
  static Insertable<GitActionLogRow> custom({
    Expression<String>? id,
    Expression<String>? threadId,
    Expression<String>? kind,
    Expression<String>? status,
    Expression<String>? paramsJson,
    Expression<String>? resultJson,
    Expression<String>? errorMessage,
    Expression<int>? startedAtMs,
    Expression<int>? completedAtMs,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (threadId != null) 'thread_id': threadId,
      if (kind != null) 'kind': kind,
      if (status != null) 'status': status,
      if (paramsJson != null) 'params_json': paramsJson,
      if (resultJson != null) 'result_json': resultJson,
      if (errorMessage != null) 'error_message': errorMessage,
      if (startedAtMs != null) 'started_at_ms': startedAtMs,
      if (completedAtMs != null) 'completed_at_ms': completedAtMs,
      if (rowid != null) 'rowid': rowid,
    });
  }

  GitActionLogTableCompanion copyWith(
      {Value<String>? id,
      Value<String>? threadId,
      Value<String>? kind,
      Value<String>? status,
      Value<String>? paramsJson,
      Value<String?>? resultJson,
      Value<String?>? errorMessage,
      Value<int>? startedAtMs,
      Value<int?>? completedAtMs,
      Value<int>? rowid}) {
    return GitActionLogTableCompanion(
      id: id ?? this.id,
      threadId: threadId ?? this.threadId,
      kind: kind ?? this.kind,
      status: status ?? this.status,
      paramsJson: paramsJson ?? this.paramsJson,
      resultJson: resultJson ?? this.resultJson,
      errorMessage: errorMessage ?? this.errorMessage,
      startedAtMs: startedAtMs ?? this.startedAtMs,
      completedAtMs: completedAtMs ?? this.completedAtMs,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (threadId.present) {
      map['thread_id'] = Variable<String>(threadId.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (paramsJson.present) {
      map['params_json'] = Variable<String>(paramsJson.value);
    }
    if (resultJson.present) {
      map['result_json'] = Variable<String>(resultJson.value);
    }
    if (errorMessage.present) {
      map['error_message'] = Variable<String>(errorMessage.value);
    }
    if (startedAtMs.present) {
      map['started_at_ms'] = Variable<int>(startedAtMs.value);
    }
    if (completedAtMs.present) {
      map['completed_at_ms'] = Variable<int>(completedAtMs.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('GitActionLogTableCompanion(')
          ..write('id: $id, ')
          ..write('threadId: $threadId, ')
          ..write('kind: $kind, ')
          ..write('status: $status, ')
          ..write('paramsJson: $paramsJson, ')
          ..write('resultJson: $resultJson, ')
          ..write('errorMessage: $errorMessage, ')
          ..write('startedAtMs: $startedAtMs, ')
          ..write('completedAtMs: $completedAtMs, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $ConnectionSessionsTableTable extends ConnectionSessionsTable
    with TableInfo<$ConnectionSessionsTableTable, ConnectionSessionRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ConnectionSessionsTableTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _deviceIdMeta =
      const VerificationMeta('deviceId');
  @override
  late final GeneratedColumn<String> deviceId = GeneratedColumn<String>(
      'device_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _transportMeta =
      const VerificationMeta('transport');
  @override
  late final GeneratedColumn<String> transport = GeneratedColumn<String>(
      'transport', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _endpointMeta =
      const VerificationMeta('endpoint');
  @override
  late final GeneratedColumn<String> endpoint = GeneratedColumn<String>(
      'endpoint', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _startedAtMsMeta =
      const VerificationMeta('startedAtMs');
  @override
  late final GeneratedColumn<int> startedAtMs = GeneratedColumn<int>(
      'started_at_ms', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _lastActiveAtMsMeta =
      const VerificationMeta('lastActiveAtMs');
  @override
  late final GeneratedColumn<int> lastActiveAtMs = GeneratedColumn<int>(
      'last_active_at_ms', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _endedAtMsMeta =
      const VerificationMeta('endedAtMs');
  @override
  late final GeneratedColumn<int> endedAtMs = GeneratedColumn<int>(
      'ended_at_ms', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        deviceId,
        transport,
        endpoint,
        startedAtMs,
        lastActiveAtMs,
        endedAtMs
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'connection_sessions_table';
  @override
  VerificationContext validateIntegrity(
      Insertable<ConnectionSessionRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('device_id')) {
      context.handle(_deviceIdMeta,
          deviceId.isAcceptableOrUnknown(data['device_id']!, _deviceIdMeta));
    } else if (isInserting) {
      context.missing(_deviceIdMeta);
    }
    if (data.containsKey('transport')) {
      context.handle(_transportMeta,
          transport.isAcceptableOrUnknown(data['transport']!, _transportMeta));
    } else if (isInserting) {
      context.missing(_transportMeta);
    }
    if (data.containsKey('endpoint')) {
      context.handle(_endpointMeta,
          endpoint.isAcceptableOrUnknown(data['endpoint']!, _endpointMeta));
    }
    if (data.containsKey('started_at_ms')) {
      context.handle(
          _startedAtMsMeta,
          startedAtMs.isAcceptableOrUnknown(
              data['started_at_ms']!, _startedAtMsMeta));
    } else if (isInserting) {
      context.missing(_startedAtMsMeta);
    }
    if (data.containsKey('last_active_at_ms')) {
      context.handle(
          _lastActiveAtMsMeta,
          lastActiveAtMs.isAcceptableOrUnknown(
              data['last_active_at_ms']!, _lastActiveAtMsMeta));
    } else if (isInserting) {
      context.missing(_lastActiveAtMsMeta);
    }
    if (data.containsKey('ended_at_ms')) {
      context.handle(
          _endedAtMsMeta,
          endedAtMs.isAcceptableOrUnknown(
              data['ended_at_ms']!, _endedAtMsMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  ConnectionSessionRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ConnectionSessionRow(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      deviceId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}device_id'])!,
      transport: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}transport'])!,
      endpoint: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}endpoint']),
      startedAtMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}started_at_ms'])!,
      lastActiveAtMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}last_active_at_ms'])!,
      endedAtMs: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}ended_at_ms']),
    );
  }

  @override
  $ConnectionSessionsTableTable createAlias(String alias) {
    return $ConnectionSessionsTableTable(attachedDatabase, alias);
  }
}

class ConnectionSessionRow extends DataClass
    implements Insertable<ConnectionSessionRow> {
  /// Unique session id (primary key).
  final String id;

  /// The `macDeviceId` of the PC this session connected to.
  final String deviceId;

  /// `ConnectionTransport` serialized as its enum name (`direct` / `relay`).
  final String transport;

  /// The real URL the channel used (winning direct host, or the relay), if
  /// known.
  final String? endpoint;

  /// When the live channel was committed, in epoch milliseconds.
  final int startedAtMs;

  /// Last moment the channel was confirmed alive (heartbeat), in epoch ms.
  final int lastActiveAtMs;

  /// When the session was torn down, in epoch ms, or null while still open.
  final int? endedAtMs;
  const ConnectionSessionRow(
      {required this.id,
      required this.deviceId,
      required this.transport,
      this.endpoint,
      required this.startedAtMs,
      required this.lastActiveAtMs,
      this.endedAtMs});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['device_id'] = Variable<String>(deviceId);
    map['transport'] = Variable<String>(transport);
    if (!nullToAbsent || endpoint != null) {
      map['endpoint'] = Variable<String>(endpoint);
    }
    map['started_at_ms'] = Variable<int>(startedAtMs);
    map['last_active_at_ms'] = Variable<int>(lastActiveAtMs);
    if (!nullToAbsent || endedAtMs != null) {
      map['ended_at_ms'] = Variable<int>(endedAtMs);
    }
    return map;
  }

  ConnectionSessionsTableCompanion toCompanion(bool nullToAbsent) {
    return ConnectionSessionsTableCompanion(
      id: Value(id),
      deviceId: Value(deviceId),
      transport: Value(transport),
      endpoint: endpoint == null && nullToAbsent
          ? const Value.absent()
          : Value(endpoint),
      startedAtMs: Value(startedAtMs),
      lastActiveAtMs: Value(lastActiveAtMs),
      endedAtMs: endedAtMs == null && nullToAbsent
          ? const Value.absent()
          : Value(endedAtMs),
    );
  }

  factory ConnectionSessionRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ConnectionSessionRow(
      id: serializer.fromJson<String>(json['id']),
      deviceId: serializer.fromJson<String>(json['deviceId']),
      transport: serializer.fromJson<String>(json['transport']),
      endpoint: serializer.fromJson<String?>(json['endpoint']),
      startedAtMs: serializer.fromJson<int>(json['startedAtMs']),
      lastActiveAtMs: serializer.fromJson<int>(json['lastActiveAtMs']),
      endedAtMs: serializer.fromJson<int?>(json['endedAtMs']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'deviceId': serializer.toJson<String>(deviceId),
      'transport': serializer.toJson<String>(transport),
      'endpoint': serializer.toJson<String?>(endpoint),
      'startedAtMs': serializer.toJson<int>(startedAtMs),
      'lastActiveAtMs': serializer.toJson<int>(lastActiveAtMs),
      'endedAtMs': serializer.toJson<int?>(endedAtMs),
    };
  }

  ConnectionSessionRow copyWith(
          {String? id,
          String? deviceId,
          String? transport,
          Value<String?> endpoint = const Value.absent(),
          int? startedAtMs,
          int? lastActiveAtMs,
          Value<int?> endedAtMs = const Value.absent()}) =>
      ConnectionSessionRow(
        id: id ?? this.id,
        deviceId: deviceId ?? this.deviceId,
        transport: transport ?? this.transport,
        endpoint: endpoint.present ? endpoint.value : this.endpoint,
        startedAtMs: startedAtMs ?? this.startedAtMs,
        lastActiveAtMs: lastActiveAtMs ?? this.lastActiveAtMs,
        endedAtMs: endedAtMs.present ? endedAtMs.value : this.endedAtMs,
      );
  ConnectionSessionRow copyWithCompanion(
      ConnectionSessionsTableCompanion data) {
    return ConnectionSessionRow(
      id: data.id.present ? data.id.value : this.id,
      deviceId: data.deviceId.present ? data.deviceId.value : this.deviceId,
      transport: data.transport.present ? data.transport.value : this.transport,
      endpoint: data.endpoint.present ? data.endpoint.value : this.endpoint,
      startedAtMs:
          data.startedAtMs.present ? data.startedAtMs.value : this.startedAtMs,
      lastActiveAtMs: data.lastActiveAtMs.present
          ? data.lastActiveAtMs.value
          : this.lastActiveAtMs,
      endedAtMs: data.endedAtMs.present ? data.endedAtMs.value : this.endedAtMs,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ConnectionSessionRow(')
          ..write('id: $id, ')
          ..write('deviceId: $deviceId, ')
          ..write('transport: $transport, ')
          ..write('endpoint: $endpoint, ')
          ..write('startedAtMs: $startedAtMs, ')
          ..write('lastActiveAtMs: $lastActiveAtMs, ')
          ..write('endedAtMs: $endedAtMs')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, deviceId, transport, endpoint,
      startedAtMs, lastActiveAtMs, endedAtMs);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ConnectionSessionRow &&
          other.id == this.id &&
          other.deviceId == this.deviceId &&
          other.transport == this.transport &&
          other.endpoint == this.endpoint &&
          other.startedAtMs == this.startedAtMs &&
          other.lastActiveAtMs == this.lastActiveAtMs &&
          other.endedAtMs == this.endedAtMs);
}

class ConnectionSessionsTableCompanion
    extends UpdateCompanion<ConnectionSessionRow> {
  final Value<String> id;
  final Value<String> deviceId;
  final Value<String> transport;
  final Value<String?> endpoint;
  final Value<int> startedAtMs;
  final Value<int> lastActiveAtMs;
  final Value<int?> endedAtMs;
  final Value<int> rowid;
  const ConnectionSessionsTableCompanion({
    this.id = const Value.absent(),
    this.deviceId = const Value.absent(),
    this.transport = const Value.absent(),
    this.endpoint = const Value.absent(),
    this.startedAtMs = const Value.absent(),
    this.lastActiveAtMs = const Value.absent(),
    this.endedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ConnectionSessionsTableCompanion.insert({
    required String id,
    required String deviceId,
    required String transport,
    this.endpoint = const Value.absent(),
    required int startedAtMs,
    required int lastActiveAtMs,
    this.endedAtMs = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        deviceId = Value(deviceId),
        transport = Value(transport),
        startedAtMs = Value(startedAtMs),
        lastActiveAtMs = Value(lastActiveAtMs);
  static Insertable<ConnectionSessionRow> custom({
    Expression<String>? id,
    Expression<String>? deviceId,
    Expression<String>? transport,
    Expression<String>? endpoint,
    Expression<int>? startedAtMs,
    Expression<int>? lastActiveAtMs,
    Expression<int>? endedAtMs,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (deviceId != null) 'device_id': deviceId,
      if (transport != null) 'transport': transport,
      if (endpoint != null) 'endpoint': endpoint,
      if (startedAtMs != null) 'started_at_ms': startedAtMs,
      if (lastActiveAtMs != null) 'last_active_at_ms': lastActiveAtMs,
      if (endedAtMs != null) 'ended_at_ms': endedAtMs,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ConnectionSessionsTableCompanion copyWith(
      {Value<String>? id,
      Value<String>? deviceId,
      Value<String>? transport,
      Value<String?>? endpoint,
      Value<int>? startedAtMs,
      Value<int>? lastActiveAtMs,
      Value<int?>? endedAtMs,
      Value<int>? rowid}) {
    return ConnectionSessionsTableCompanion(
      id: id ?? this.id,
      deviceId: deviceId ?? this.deviceId,
      transport: transport ?? this.transport,
      endpoint: endpoint ?? this.endpoint,
      startedAtMs: startedAtMs ?? this.startedAtMs,
      lastActiveAtMs: lastActiveAtMs ?? this.lastActiveAtMs,
      endedAtMs: endedAtMs ?? this.endedAtMs,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (deviceId.present) {
      map['device_id'] = Variable<String>(deviceId.value);
    }
    if (transport.present) {
      map['transport'] = Variable<String>(transport.value);
    }
    if (endpoint.present) {
      map['endpoint'] = Variable<String>(endpoint.value);
    }
    if (startedAtMs.present) {
      map['started_at_ms'] = Variable<int>(startedAtMs.value);
    }
    if (lastActiveAtMs.present) {
      map['last_active_at_ms'] = Variable<int>(lastActiveAtMs.value);
    }
    if (endedAtMs.present) {
      map['ended_at_ms'] = Variable<int>(endedAtMs.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ConnectionSessionsTableCompanion(')
          ..write('id: $id, ')
          ..write('deviceId: $deviceId, ')
          ..write('transport: $transport, ')
          ..write('endpoint: $endpoint, ')
          ..write('startedAtMs: $startedAtMs, ')
          ..write('lastActiveAtMs: $lastActiveAtMs, ')
          ..write('endedAtMs: $endedAtMs, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$UxnanDatabase extends GeneratedDatabase {
  _$UxnanDatabase(QueryExecutor e) : super(e);
  $UxnanDatabaseManager get managers => $UxnanDatabaseManager(this);
  late final $ThreadsTableTable threadsTable = $ThreadsTableTable(this);
  late final $MessagesTableTable messagesTable = $MessagesTableTable(this);
  late final $TurnsTableTable turnsTable = $TurnsTableTable(this);
  late final $ProjectsTableTable projectsTable = $ProjectsTableTable(this);
  late final $TrustedDevicesTableTable trustedDevicesTable =
      $TrustedDevicesTableTable(this);
  late final $ComposerDraftsTableTable composerDraftsTable =
      $ComposerDraftsTableTable(this);
  late final $GitActionLogTableTable gitActionLogTable =
      $GitActionLogTableTable(this);
  late final $ConnectionSessionsTableTable connectionSessionsTable =
      $ConnectionSessionsTableTable(this);
  late final Index idxMessagesThreadId = Index('idx_messages_thread_id',
      'CREATE INDEX idx_messages_thread_id ON messages_table (thread_id, order_index)');
  late final Index idxTurnsThreadId = Index('idx_turns_thread_id',
      'CREATE INDEX idx_turns_thread_id ON turns_table (thread_id)');
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
        threadsTable,
        messagesTable,
        turnsTable,
        projectsTable,
        trustedDevicesTable,
        composerDraftsTable,
        gitActionLogTable,
        connectionSessionsTable,
        idxMessagesThreadId,
        idxTurnsThreadId
      ];
}

typedef $$ThreadsTableTableCreateCompanionBuilder = ThreadsTableCompanion
    Function({
  required String id,
  required String title,
  Value<String?> projectId,
  Value<String?> deviceId,
  Value<String?> cwd,
  Value<String?> worktreePath,
  required String agentId,
  Value<String?> model,
  required String syncState,
  required String status,
  Value<int?> lastActivityMs,
  required int createdAtMs,
  Value<int> rowid,
});
typedef $$ThreadsTableTableUpdateCompanionBuilder = ThreadsTableCompanion
    Function({
  Value<String> id,
  Value<String> title,
  Value<String?> projectId,
  Value<String?> deviceId,
  Value<String?> cwd,
  Value<String?> worktreePath,
  Value<String> agentId,
  Value<String?> model,
  Value<String> syncState,
  Value<String> status,
  Value<int?> lastActivityMs,
  Value<int> createdAtMs,
  Value<int> rowid,
});

class $$ThreadsTableTableFilterComposer
    extends Composer<_$UxnanDatabase, $ThreadsTableTable> {
  $$ThreadsTableTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get title => $composableBuilder(
      column: $table.title, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get projectId => $composableBuilder(
      column: $table.projectId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get deviceId => $composableBuilder(
      column: $table.deviceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get cwd => $composableBuilder(
      column: $table.cwd, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get worktreePath => $composableBuilder(
      column: $table.worktreePath, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get agentId => $composableBuilder(
      column: $table.agentId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get model => $composableBuilder(
      column: $table.model, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get syncState => $composableBuilder(
      column: $table.syncState, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get lastActivityMs => $composableBuilder(
      column: $table.lastActivityMs,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get createdAtMs => $composableBuilder(
      column: $table.createdAtMs, builder: (column) => ColumnFilters(column));
}

class $$ThreadsTableTableOrderingComposer
    extends Composer<_$UxnanDatabase, $ThreadsTableTable> {
  $$ThreadsTableTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get title => $composableBuilder(
      column: $table.title, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get projectId => $composableBuilder(
      column: $table.projectId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get deviceId => $composableBuilder(
      column: $table.deviceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get cwd => $composableBuilder(
      column: $table.cwd, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get worktreePath => $composableBuilder(
      column: $table.worktreePath,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get agentId => $composableBuilder(
      column: $table.agentId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get model => $composableBuilder(
      column: $table.model, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get syncState => $composableBuilder(
      column: $table.syncState, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get lastActivityMs => $composableBuilder(
      column: $table.lastActivityMs,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get createdAtMs => $composableBuilder(
      column: $table.createdAtMs, builder: (column) => ColumnOrderings(column));
}

class $$ThreadsTableTableAnnotationComposer
    extends Composer<_$UxnanDatabase, $ThreadsTableTable> {
  $$ThreadsTableTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get title =>
      $composableBuilder(column: $table.title, builder: (column) => column);

  GeneratedColumn<String> get projectId =>
      $composableBuilder(column: $table.projectId, builder: (column) => column);

  GeneratedColumn<String> get deviceId =>
      $composableBuilder(column: $table.deviceId, builder: (column) => column);

  GeneratedColumn<String> get cwd =>
      $composableBuilder(column: $table.cwd, builder: (column) => column);

  GeneratedColumn<String> get worktreePath => $composableBuilder(
      column: $table.worktreePath, builder: (column) => column);

  GeneratedColumn<String> get agentId =>
      $composableBuilder(column: $table.agentId, builder: (column) => column);

  GeneratedColumn<String> get model =>
      $composableBuilder(column: $table.model, builder: (column) => column);

  GeneratedColumn<String> get syncState =>
      $composableBuilder(column: $table.syncState, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<int> get lastActivityMs => $composableBuilder(
      column: $table.lastActivityMs, builder: (column) => column);

  GeneratedColumn<int> get createdAtMs => $composableBuilder(
      column: $table.createdAtMs, builder: (column) => column);
}

class $$ThreadsTableTableTableManager extends RootTableManager<
    _$UxnanDatabase,
    $ThreadsTableTable,
    ThreadRow,
    $$ThreadsTableTableFilterComposer,
    $$ThreadsTableTableOrderingComposer,
    $$ThreadsTableTableAnnotationComposer,
    $$ThreadsTableTableCreateCompanionBuilder,
    $$ThreadsTableTableUpdateCompanionBuilder,
    (ThreadRow, BaseReferences<_$UxnanDatabase, $ThreadsTableTable, ThreadRow>),
    ThreadRow,
    PrefetchHooks Function()> {
  $$ThreadsTableTableTableManager(_$UxnanDatabase db, $ThreadsTableTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ThreadsTableTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ThreadsTableTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ThreadsTableTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> title = const Value.absent(),
            Value<String?> projectId = const Value.absent(),
            Value<String?> deviceId = const Value.absent(),
            Value<String?> cwd = const Value.absent(),
            Value<String?> worktreePath = const Value.absent(),
            Value<String> agentId = const Value.absent(),
            Value<String?> model = const Value.absent(),
            Value<String> syncState = const Value.absent(),
            Value<String> status = const Value.absent(),
            Value<int?> lastActivityMs = const Value.absent(),
            Value<int> createdAtMs = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ThreadsTableCompanion(
            id: id,
            title: title,
            projectId: projectId,
            deviceId: deviceId,
            cwd: cwd,
            worktreePath: worktreePath,
            agentId: agentId,
            model: model,
            syncState: syncState,
            status: status,
            lastActivityMs: lastActivityMs,
            createdAtMs: createdAtMs,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String title,
            Value<String?> projectId = const Value.absent(),
            Value<String?> deviceId = const Value.absent(),
            Value<String?> cwd = const Value.absent(),
            Value<String?> worktreePath = const Value.absent(),
            required String agentId,
            Value<String?> model = const Value.absent(),
            required String syncState,
            required String status,
            Value<int?> lastActivityMs = const Value.absent(),
            required int createdAtMs,
            Value<int> rowid = const Value.absent(),
          }) =>
              ThreadsTableCompanion.insert(
            id: id,
            title: title,
            projectId: projectId,
            deviceId: deviceId,
            cwd: cwd,
            worktreePath: worktreePath,
            agentId: agentId,
            model: model,
            syncState: syncState,
            status: status,
            lastActivityMs: lastActivityMs,
            createdAtMs: createdAtMs,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$ThreadsTableTableProcessedTableManager = ProcessedTableManager<
    _$UxnanDatabase,
    $ThreadsTableTable,
    ThreadRow,
    $$ThreadsTableTableFilterComposer,
    $$ThreadsTableTableOrderingComposer,
    $$ThreadsTableTableAnnotationComposer,
    $$ThreadsTableTableCreateCompanionBuilder,
    $$ThreadsTableTableUpdateCompanionBuilder,
    (ThreadRow, BaseReferences<_$UxnanDatabase, $ThreadsTableTable, ThreadRow>),
    ThreadRow,
    PrefetchHooks Function()>;
typedef $$MessagesTableTableCreateCompanionBuilder = MessagesTableCompanion
    Function({
  required String id,
  required String threadId,
  required String turnId,
  required String role,
  required String contentsJson,
  required String deliveryState,
  required int orderIndex,
  Value<String?> fingerprint,
  required int createdAtMs,
  Value<int> rowid,
});
typedef $$MessagesTableTableUpdateCompanionBuilder = MessagesTableCompanion
    Function({
  Value<String> id,
  Value<String> threadId,
  Value<String> turnId,
  Value<String> role,
  Value<String> contentsJson,
  Value<String> deliveryState,
  Value<int> orderIndex,
  Value<String?> fingerprint,
  Value<int> createdAtMs,
  Value<int> rowid,
});

class $$MessagesTableTableFilterComposer
    extends Composer<_$UxnanDatabase, $MessagesTableTable> {
  $$MessagesTableTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get threadId => $composableBuilder(
      column: $table.threadId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get turnId => $composableBuilder(
      column: $table.turnId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get role => $composableBuilder(
      column: $table.role, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get contentsJson => $composableBuilder(
      column: $table.contentsJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get deliveryState => $composableBuilder(
      column: $table.deliveryState, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get orderIndex => $composableBuilder(
      column: $table.orderIndex, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get fingerprint => $composableBuilder(
      column: $table.fingerprint, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get createdAtMs => $composableBuilder(
      column: $table.createdAtMs, builder: (column) => ColumnFilters(column));
}

class $$MessagesTableTableOrderingComposer
    extends Composer<_$UxnanDatabase, $MessagesTableTable> {
  $$MessagesTableTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get threadId => $composableBuilder(
      column: $table.threadId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get turnId => $composableBuilder(
      column: $table.turnId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get role => $composableBuilder(
      column: $table.role, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get contentsJson => $composableBuilder(
      column: $table.contentsJson,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get deliveryState => $composableBuilder(
      column: $table.deliveryState,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get orderIndex => $composableBuilder(
      column: $table.orderIndex, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get fingerprint => $composableBuilder(
      column: $table.fingerprint, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get createdAtMs => $composableBuilder(
      column: $table.createdAtMs, builder: (column) => ColumnOrderings(column));
}

class $$MessagesTableTableAnnotationComposer
    extends Composer<_$UxnanDatabase, $MessagesTableTable> {
  $$MessagesTableTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get threadId =>
      $composableBuilder(column: $table.threadId, builder: (column) => column);

  GeneratedColumn<String> get turnId =>
      $composableBuilder(column: $table.turnId, builder: (column) => column);

  GeneratedColumn<String> get role =>
      $composableBuilder(column: $table.role, builder: (column) => column);

  GeneratedColumn<String> get contentsJson => $composableBuilder(
      column: $table.contentsJson, builder: (column) => column);

  GeneratedColumn<String> get deliveryState => $composableBuilder(
      column: $table.deliveryState, builder: (column) => column);

  GeneratedColumn<int> get orderIndex => $composableBuilder(
      column: $table.orderIndex, builder: (column) => column);

  GeneratedColumn<String> get fingerprint => $composableBuilder(
      column: $table.fingerprint, builder: (column) => column);

  GeneratedColumn<int> get createdAtMs => $composableBuilder(
      column: $table.createdAtMs, builder: (column) => column);
}

class $$MessagesTableTableTableManager extends RootTableManager<
    _$UxnanDatabase,
    $MessagesTableTable,
    MessageRow,
    $$MessagesTableTableFilterComposer,
    $$MessagesTableTableOrderingComposer,
    $$MessagesTableTableAnnotationComposer,
    $$MessagesTableTableCreateCompanionBuilder,
    $$MessagesTableTableUpdateCompanionBuilder,
    (
      MessageRow,
      BaseReferences<_$UxnanDatabase, $MessagesTableTable, MessageRow>
    ),
    MessageRow,
    PrefetchHooks Function()> {
  $$MessagesTableTableTableManager(
      _$UxnanDatabase db, $MessagesTableTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MessagesTableTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MessagesTableTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MessagesTableTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> threadId = const Value.absent(),
            Value<String> turnId = const Value.absent(),
            Value<String> role = const Value.absent(),
            Value<String> contentsJson = const Value.absent(),
            Value<String> deliveryState = const Value.absent(),
            Value<int> orderIndex = const Value.absent(),
            Value<String?> fingerprint = const Value.absent(),
            Value<int> createdAtMs = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              MessagesTableCompanion(
            id: id,
            threadId: threadId,
            turnId: turnId,
            role: role,
            contentsJson: contentsJson,
            deliveryState: deliveryState,
            orderIndex: orderIndex,
            fingerprint: fingerprint,
            createdAtMs: createdAtMs,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String threadId,
            required String turnId,
            required String role,
            required String contentsJson,
            required String deliveryState,
            required int orderIndex,
            Value<String?> fingerprint = const Value.absent(),
            required int createdAtMs,
            Value<int> rowid = const Value.absent(),
          }) =>
              MessagesTableCompanion.insert(
            id: id,
            threadId: threadId,
            turnId: turnId,
            role: role,
            contentsJson: contentsJson,
            deliveryState: deliveryState,
            orderIndex: orderIndex,
            fingerprint: fingerprint,
            createdAtMs: createdAtMs,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$MessagesTableTableProcessedTableManager = ProcessedTableManager<
    _$UxnanDatabase,
    $MessagesTableTable,
    MessageRow,
    $$MessagesTableTableFilterComposer,
    $$MessagesTableTableOrderingComposer,
    $$MessagesTableTableAnnotationComposer,
    $$MessagesTableTableCreateCompanionBuilder,
    $$MessagesTableTableUpdateCompanionBuilder,
    (
      MessageRow,
      BaseReferences<_$UxnanDatabase, $MessagesTableTable, MessageRow>
    ),
    MessageRow,
    PrefetchHooks Function()>;
typedef $$TurnsTableTableCreateCompanionBuilder = TurnsTableCompanion Function({
  required String id,
  required String threadId,
  required String status,
  Value<String?> gitProgressJson,
  Value<String?> subagentStateJson,
  Value<String?> planStateJson,
  required int startedAtMs,
  Value<int?> completedAtMs,
  Value<int> rowid,
});
typedef $$TurnsTableTableUpdateCompanionBuilder = TurnsTableCompanion Function({
  Value<String> id,
  Value<String> threadId,
  Value<String> status,
  Value<String?> gitProgressJson,
  Value<String?> subagentStateJson,
  Value<String?> planStateJson,
  Value<int> startedAtMs,
  Value<int?> completedAtMs,
  Value<int> rowid,
});

class $$TurnsTableTableFilterComposer
    extends Composer<_$UxnanDatabase, $TurnsTableTable> {
  $$TurnsTableTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get threadId => $composableBuilder(
      column: $table.threadId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get gitProgressJson => $composableBuilder(
      column: $table.gitProgressJson,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get subagentStateJson => $composableBuilder(
      column: $table.subagentStateJson,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get planStateJson => $composableBuilder(
      column: $table.planStateJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get startedAtMs => $composableBuilder(
      column: $table.startedAtMs, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get completedAtMs => $composableBuilder(
      column: $table.completedAtMs, builder: (column) => ColumnFilters(column));
}

class $$TurnsTableTableOrderingComposer
    extends Composer<_$UxnanDatabase, $TurnsTableTable> {
  $$TurnsTableTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get threadId => $composableBuilder(
      column: $table.threadId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get gitProgressJson => $composableBuilder(
      column: $table.gitProgressJson,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get subagentStateJson => $composableBuilder(
      column: $table.subagentStateJson,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get planStateJson => $composableBuilder(
      column: $table.planStateJson,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get startedAtMs => $composableBuilder(
      column: $table.startedAtMs, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get completedAtMs => $composableBuilder(
      column: $table.completedAtMs,
      builder: (column) => ColumnOrderings(column));
}

class $$TurnsTableTableAnnotationComposer
    extends Composer<_$UxnanDatabase, $TurnsTableTable> {
  $$TurnsTableTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get threadId =>
      $composableBuilder(column: $table.threadId, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<String> get gitProgressJson => $composableBuilder(
      column: $table.gitProgressJson, builder: (column) => column);

  GeneratedColumn<String> get subagentStateJson => $composableBuilder(
      column: $table.subagentStateJson, builder: (column) => column);

  GeneratedColumn<String> get planStateJson => $composableBuilder(
      column: $table.planStateJson, builder: (column) => column);

  GeneratedColumn<int> get startedAtMs => $composableBuilder(
      column: $table.startedAtMs, builder: (column) => column);

  GeneratedColumn<int> get completedAtMs => $composableBuilder(
      column: $table.completedAtMs, builder: (column) => column);
}

class $$TurnsTableTableTableManager extends RootTableManager<
    _$UxnanDatabase,
    $TurnsTableTable,
    TurnRow,
    $$TurnsTableTableFilterComposer,
    $$TurnsTableTableOrderingComposer,
    $$TurnsTableTableAnnotationComposer,
    $$TurnsTableTableCreateCompanionBuilder,
    $$TurnsTableTableUpdateCompanionBuilder,
    (TurnRow, BaseReferences<_$UxnanDatabase, $TurnsTableTable, TurnRow>),
    TurnRow,
    PrefetchHooks Function()> {
  $$TurnsTableTableTableManager(_$UxnanDatabase db, $TurnsTableTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$TurnsTableTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$TurnsTableTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$TurnsTableTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> threadId = const Value.absent(),
            Value<String> status = const Value.absent(),
            Value<String?> gitProgressJson = const Value.absent(),
            Value<String?> subagentStateJson = const Value.absent(),
            Value<String?> planStateJson = const Value.absent(),
            Value<int> startedAtMs = const Value.absent(),
            Value<int?> completedAtMs = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              TurnsTableCompanion(
            id: id,
            threadId: threadId,
            status: status,
            gitProgressJson: gitProgressJson,
            subagentStateJson: subagentStateJson,
            planStateJson: planStateJson,
            startedAtMs: startedAtMs,
            completedAtMs: completedAtMs,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String threadId,
            required String status,
            Value<String?> gitProgressJson = const Value.absent(),
            Value<String?> subagentStateJson = const Value.absent(),
            Value<String?> planStateJson = const Value.absent(),
            required int startedAtMs,
            Value<int?> completedAtMs = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              TurnsTableCompanion.insert(
            id: id,
            threadId: threadId,
            status: status,
            gitProgressJson: gitProgressJson,
            subagentStateJson: subagentStateJson,
            planStateJson: planStateJson,
            startedAtMs: startedAtMs,
            completedAtMs: completedAtMs,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$TurnsTableTableProcessedTableManager = ProcessedTableManager<
    _$UxnanDatabase,
    $TurnsTableTable,
    TurnRow,
    $$TurnsTableTableFilterComposer,
    $$TurnsTableTableOrderingComposer,
    $$TurnsTableTableAnnotationComposer,
    $$TurnsTableTableCreateCompanionBuilder,
    $$TurnsTableTableUpdateCompanionBuilder,
    (TurnRow, BaseReferences<_$UxnanDatabase, $TurnsTableTable, TurnRow>),
    TurnRow,
    PrefetchHooks Function()>;
typedef $$ProjectsTableTableCreateCompanionBuilder = ProjectsTableCompanion
    Function({
  required String id,
  required String displayName,
  required String cwd,
  required String agentId,
  required String agentConfigJson,
  Value<int?> lastActiveMs,
  Value<int> rowid,
});
typedef $$ProjectsTableTableUpdateCompanionBuilder = ProjectsTableCompanion
    Function({
  Value<String> id,
  Value<String> displayName,
  Value<String> cwd,
  Value<String> agentId,
  Value<String> agentConfigJson,
  Value<int?> lastActiveMs,
  Value<int> rowid,
});

class $$ProjectsTableTableFilterComposer
    extends Composer<_$UxnanDatabase, $ProjectsTableTable> {
  $$ProjectsTableTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get displayName => $composableBuilder(
      column: $table.displayName, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get cwd => $composableBuilder(
      column: $table.cwd, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get agentId => $composableBuilder(
      column: $table.agentId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get agentConfigJson => $composableBuilder(
      column: $table.agentConfigJson,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get lastActiveMs => $composableBuilder(
      column: $table.lastActiveMs, builder: (column) => ColumnFilters(column));
}

class $$ProjectsTableTableOrderingComposer
    extends Composer<_$UxnanDatabase, $ProjectsTableTable> {
  $$ProjectsTableTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get displayName => $composableBuilder(
      column: $table.displayName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get cwd => $composableBuilder(
      column: $table.cwd, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get agentId => $composableBuilder(
      column: $table.agentId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get agentConfigJson => $composableBuilder(
      column: $table.agentConfigJson,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get lastActiveMs => $composableBuilder(
      column: $table.lastActiveMs,
      builder: (column) => ColumnOrderings(column));
}

class $$ProjectsTableTableAnnotationComposer
    extends Composer<_$UxnanDatabase, $ProjectsTableTable> {
  $$ProjectsTableTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get displayName => $composableBuilder(
      column: $table.displayName, builder: (column) => column);

  GeneratedColumn<String> get cwd =>
      $composableBuilder(column: $table.cwd, builder: (column) => column);

  GeneratedColumn<String> get agentId =>
      $composableBuilder(column: $table.agentId, builder: (column) => column);

  GeneratedColumn<String> get agentConfigJson => $composableBuilder(
      column: $table.agentConfigJson, builder: (column) => column);

  GeneratedColumn<int> get lastActiveMs => $composableBuilder(
      column: $table.lastActiveMs, builder: (column) => column);
}

class $$ProjectsTableTableTableManager extends RootTableManager<
    _$UxnanDatabase,
    $ProjectsTableTable,
    ProjectRow,
    $$ProjectsTableTableFilterComposer,
    $$ProjectsTableTableOrderingComposer,
    $$ProjectsTableTableAnnotationComposer,
    $$ProjectsTableTableCreateCompanionBuilder,
    $$ProjectsTableTableUpdateCompanionBuilder,
    (
      ProjectRow,
      BaseReferences<_$UxnanDatabase, $ProjectsTableTable, ProjectRow>
    ),
    ProjectRow,
    PrefetchHooks Function()> {
  $$ProjectsTableTableTableManager(
      _$UxnanDatabase db, $ProjectsTableTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ProjectsTableTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ProjectsTableTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ProjectsTableTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> displayName = const Value.absent(),
            Value<String> cwd = const Value.absent(),
            Value<String> agentId = const Value.absent(),
            Value<String> agentConfigJson = const Value.absent(),
            Value<int?> lastActiveMs = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ProjectsTableCompanion(
            id: id,
            displayName: displayName,
            cwd: cwd,
            agentId: agentId,
            agentConfigJson: agentConfigJson,
            lastActiveMs: lastActiveMs,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String displayName,
            required String cwd,
            required String agentId,
            required String agentConfigJson,
            Value<int?> lastActiveMs = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ProjectsTableCompanion.insert(
            id: id,
            displayName: displayName,
            cwd: cwd,
            agentId: agentId,
            agentConfigJson: agentConfigJson,
            lastActiveMs: lastActiveMs,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$ProjectsTableTableProcessedTableManager = ProcessedTableManager<
    _$UxnanDatabase,
    $ProjectsTableTable,
    ProjectRow,
    $$ProjectsTableTableFilterComposer,
    $$ProjectsTableTableOrderingComposer,
    $$ProjectsTableTableAnnotationComposer,
    $$ProjectsTableTableCreateCompanionBuilder,
    $$ProjectsTableTableUpdateCompanionBuilder,
    (
      ProjectRow,
      BaseReferences<_$UxnanDatabase, $ProjectsTableTable, ProjectRow>
    ),
    ProjectRow,
    PrefetchHooks Function()>;
typedef $$TrustedDevicesTableTableCreateCompanionBuilder
    = TrustedDevicesTableCompanion Function({
  required String macDeviceId,
  required String displayName,
  required String relayUrl,
  Value<String?> hosts,
  required String sessionId,
  required int pairedAtMs,
  Value<int?> lastSeenMs,
  Value<int?> lastAppliedBridgeOutboundSeq,
  Value<int> rowid,
});
typedef $$TrustedDevicesTableTableUpdateCompanionBuilder
    = TrustedDevicesTableCompanion Function({
  Value<String> macDeviceId,
  Value<String> displayName,
  Value<String> relayUrl,
  Value<String?> hosts,
  Value<String> sessionId,
  Value<int> pairedAtMs,
  Value<int?> lastSeenMs,
  Value<int?> lastAppliedBridgeOutboundSeq,
  Value<int> rowid,
});

class $$TrustedDevicesTableTableFilterComposer
    extends Composer<_$UxnanDatabase, $TrustedDevicesTableTable> {
  $$TrustedDevicesTableTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get macDeviceId => $composableBuilder(
      column: $table.macDeviceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get displayName => $composableBuilder(
      column: $table.displayName, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get relayUrl => $composableBuilder(
      column: $table.relayUrl, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get hosts => $composableBuilder(
      column: $table.hosts, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get sessionId => $composableBuilder(
      column: $table.sessionId, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get pairedAtMs => $composableBuilder(
      column: $table.pairedAtMs, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get lastSeenMs => $composableBuilder(
      column: $table.lastSeenMs, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get lastAppliedBridgeOutboundSeq => $composableBuilder(
      column: $table.lastAppliedBridgeOutboundSeq,
      builder: (column) => ColumnFilters(column));
}

class $$TrustedDevicesTableTableOrderingComposer
    extends Composer<_$UxnanDatabase, $TrustedDevicesTableTable> {
  $$TrustedDevicesTableTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get macDeviceId => $composableBuilder(
      column: $table.macDeviceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get displayName => $composableBuilder(
      column: $table.displayName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get relayUrl => $composableBuilder(
      column: $table.relayUrl, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get hosts => $composableBuilder(
      column: $table.hosts, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get sessionId => $composableBuilder(
      column: $table.sessionId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get pairedAtMs => $composableBuilder(
      column: $table.pairedAtMs, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get lastSeenMs => $composableBuilder(
      column: $table.lastSeenMs, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get lastAppliedBridgeOutboundSeq => $composableBuilder(
      column: $table.lastAppliedBridgeOutboundSeq,
      builder: (column) => ColumnOrderings(column));
}

class $$TrustedDevicesTableTableAnnotationComposer
    extends Composer<_$UxnanDatabase, $TrustedDevicesTableTable> {
  $$TrustedDevicesTableTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get macDeviceId => $composableBuilder(
      column: $table.macDeviceId, builder: (column) => column);

  GeneratedColumn<String> get displayName => $composableBuilder(
      column: $table.displayName, builder: (column) => column);

  GeneratedColumn<String> get relayUrl =>
      $composableBuilder(column: $table.relayUrl, builder: (column) => column);

  GeneratedColumn<String> get hosts =>
      $composableBuilder(column: $table.hosts, builder: (column) => column);

  GeneratedColumn<String> get sessionId =>
      $composableBuilder(column: $table.sessionId, builder: (column) => column);

  GeneratedColumn<int> get pairedAtMs => $composableBuilder(
      column: $table.pairedAtMs, builder: (column) => column);

  GeneratedColumn<int> get lastSeenMs => $composableBuilder(
      column: $table.lastSeenMs, builder: (column) => column);

  GeneratedColumn<int> get lastAppliedBridgeOutboundSeq => $composableBuilder(
      column: $table.lastAppliedBridgeOutboundSeq, builder: (column) => column);
}

class $$TrustedDevicesTableTableTableManager extends RootTableManager<
    _$UxnanDatabase,
    $TrustedDevicesTableTable,
    TrustedDeviceRow,
    $$TrustedDevicesTableTableFilterComposer,
    $$TrustedDevicesTableTableOrderingComposer,
    $$TrustedDevicesTableTableAnnotationComposer,
    $$TrustedDevicesTableTableCreateCompanionBuilder,
    $$TrustedDevicesTableTableUpdateCompanionBuilder,
    (
      TrustedDeviceRow,
      BaseReferences<_$UxnanDatabase, $TrustedDevicesTableTable,
          TrustedDeviceRow>
    ),
    TrustedDeviceRow,
    PrefetchHooks Function()> {
  $$TrustedDevicesTableTableTableManager(
      _$UxnanDatabase db, $TrustedDevicesTableTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$TrustedDevicesTableTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$TrustedDevicesTableTableOrderingComposer(
                  $db: db, $table: table),
          createComputedFieldComposer: () =>
              $$TrustedDevicesTableTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> macDeviceId = const Value.absent(),
            Value<String> displayName = const Value.absent(),
            Value<String> relayUrl = const Value.absent(),
            Value<String?> hosts = const Value.absent(),
            Value<String> sessionId = const Value.absent(),
            Value<int> pairedAtMs = const Value.absent(),
            Value<int?> lastSeenMs = const Value.absent(),
            Value<int?> lastAppliedBridgeOutboundSeq = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              TrustedDevicesTableCompanion(
            macDeviceId: macDeviceId,
            displayName: displayName,
            relayUrl: relayUrl,
            hosts: hosts,
            sessionId: sessionId,
            pairedAtMs: pairedAtMs,
            lastSeenMs: lastSeenMs,
            lastAppliedBridgeOutboundSeq: lastAppliedBridgeOutboundSeq,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String macDeviceId,
            required String displayName,
            required String relayUrl,
            Value<String?> hosts = const Value.absent(),
            required String sessionId,
            required int pairedAtMs,
            Value<int?> lastSeenMs = const Value.absent(),
            Value<int?> lastAppliedBridgeOutboundSeq = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              TrustedDevicesTableCompanion.insert(
            macDeviceId: macDeviceId,
            displayName: displayName,
            relayUrl: relayUrl,
            hosts: hosts,
            sessionId: sessionId,
            pairedAtMs: pairedAtMs,
            lastSeenMs: lastSeenMs,
            lastAppliedBridgeOutboundSeq: lastAppliedBridgeOutboundSeq,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$TrustedDevicesTableTableProcessedTableManager = ProcessedTableManager<
    _$UxnanDatabase,
    $TrustedDevicesTableTable,
    TrustedDeviceRow,
    $$TrustedDevicesTableTableFilterComposer,
    $$TrustedDevicesTableTableOrderingComposer,
    $$TrustedDevicesTableTableAnnotationComposer,
    $$TrustedDevicesTableTableCreateCompanionBuilder,
    $$TrustedDevicesTableTableUpdateCompanionBuilder,
    (
      TrustedDeviceRow,
      BaseReferences<_$UxnanDatabase, $TrustedDevicesTableTable,
          TrustedDeviceRow>
    ),
    TrustedDeviceRow,
    PrefetchHooks Function()>;
typedef $$ComposerDraftsTableTableCreateCompanionBuilder
    = ComposerDraftsTableCompanion Function({
  required String threadId,
  required String draft,
  required int updatedAtMs,
  Value<int> rowid,
});
typedef $$ComposerDraftsTableTableUpdateCompanionBuilder
    = ComposerDraftsTableCompanion Function({
  Value<String> threadId,
  Value<String> draft,
  Value<int> updatedAtMs,
  Value<int> rowid,
});

class $$ComposerDraftsTableTableFilterComposer
    extends Composer<_$UxnanDatabase, $ComposerDraftsTableTable> {
  $$ComposerDraftsTableTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get threadId => $composableBuilder(
      column: $table.threadId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get draft => $composableBuilder(
      column: $table.draft, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get updatedAtMs => $composableBuilder(
      column: $table.updatedAtMs, builder: (column) => ColumnFilters(column));
}

class $$ComposerDraftsTableTableOrderingComposer
    extends Composer<_$UxnanDatabase, $ComposerDraftsTableTable> {
  $$ComposerDraftsTableTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get threadId => $composableBuilder(
      column: $table.threadId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get draft => $composableBuilder(
      column: $table.draft, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get updatedAtMs => $composableBuilder(
      column: $table.updatedAtMs, builder: (column) => ColumnOrderings(column));
}

class $$ComposerDraftsTableTableAnnotationComposer
    extends Composer<_$UxnanDatabase, $ComposerDraftsTableTable> {
  $$ComposerDraftsTableTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get threadId =>
      $composableBuilder(column: $table.threadId, builder: (column) => column);

  GeneratedColumn<String> get draft =>
      $composableBuilder(column: $table.draft, builder: (column) => column);

  GeneratedColumn<int> get updatedAtMs => $composableBuilder(
      column: $table.updatedAtMs, builder: (column) => column);
}

class $$ComposerDraftsTableTableTableManager extends RootTableManager<
    _$UxnanDatabase,
    $ComposerDraftsTableTable,
    ComposerDraftRow,
    $$ComposerDraftsTableTableFilterComposer,
    $$ComposerDraftsTableTableOrderingComposer,
    $$ComposerDraftsTableTableAnnotationComposer,
    $$ComposerDraftsTableTableCreateCompanionBuilder,
    $$ComposerDraftsTableTableUpdateCompanionBuilder,
    (
      ComposerDraftRow,
      BaseReferences<_$UxnanDatabase, $ComposerDraftsTableTable,
          ComposerDraftRow>
    ),
    ComposerDraftRow,
    PrefetchHooks Function()> {
  $$ComposerDraftsTableTableTableManager(
      _$UxnanDatabase db, $ComposerDraftsTableTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ComposerDraftsTableTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ComposerDraftsTableTableOrderingComposer(
                  $db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ComposerDraftsTableTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> threadId = const Value.absent(),
            Value<String> draft = const Value.absent(),
            Value<int> updatedAtMs = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ComposerDraftsTableCompanion(
            threadId: threadId,
            draft: draft,
            updatedAtMs: updatedAtMs,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String threadId,
            required String draft,
            required int updatedAtMs,
            Value<int> rowid = const Value.absent(),
          }) =>
              ComposerDraftsTableCompanion.insert(
            threadId: threadId,
            draft: draft,
            updatedAtMs: updatedAtMs,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$ComposerDraftsTableTableProcessedTableManager = ProcessedTableManager<
    _$UxnanDatabase,
    $ComposerDraftsTableTable,
    ComposerDraftRow,
    $$ComposerDraftsTableTableFilterComposer,
    $$ComposerDraftsTableTableOrderingComposer,
    $$ComposerDraftsTableTableAnnotationComposer,
    $$ComposerDraftsTableTableCreateCompanionBuilder,
    $$ComposerDraftsTableTableUpdateCompanionBuilder,
    (
      ComposerDraftRow,
      BaseReferences<_$UxnanDatabase, $ComposerDraftsTableTable,
          ComposerDraftRow>
    ),
    ComposerDraftRow,
    PrefetchHooks Function()>;
typedef $$GitActionLogTableTableCreateCompanionBuilder
    = GitActionLogTableCompanion Function({
  required String id,
  required String threadId,
  required String kind,
  required String status,
  required String paramsJson,
  Value<String?> resultJson,
  Value<String?> errorMessage,
  required int startedAtMs,
  Value<int?> completedAtMs,
  Value<int> rowid,
});
typedef $$GitActionLogTableTableUpdateCompanionBuilder
    = GitActionLogTableCompanion Function({
  Value<String> id,
  Value<String> threadId,
  Value<String> kind,
  Value<String> status,
  Value<String> paramsJson,
  Value<String?> resultJson,
  Value<String?> errorMessage,
  Value<int> startedAtMs,
  Value<int?> completedAtMs,
  Value<int> rowid,
});

class $$GitActionLogTableTableFilterComposer
    extends Composer<_$UxnanDatabase, $GitActionLogTableTable> {
  $$GitActionLogTableTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get threadId => $composableBuilder(
      column: $table.threadId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get kind => $composableBuilder(
      column: $table.kind, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get paramsJson => $composableBuilder(
      column: $table.paramsJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get resultJson => $composableBuilder(
      column: $table.resultJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get errorMessage => $composableBuilder(
      column: $table.errorMessage, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get startedAtMs => $composableBuilder(
      column: $table.startedAtMs, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get completedAtMs => $composableBuilder(
      column: $table.completedAtMs, builder: (column) => ColumnFilters(column));
}

class $$GitActionLogTableTableOrderingComposer
    extends Composer<_$UxnanDatabase, $GitActionLogTableTable> {
  $$GitActionLogTableTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get threadId => $composableBuilder(
      column: $table.threadId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get kind => $composableBuilder(
      column: $table.kind, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get paramsJson => $composableBuilder(
      column: $table.paramsJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get resultJson => $composableBuilder(
      column: $table.resultJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get errorMessage => $composableBuilder(
      column: $table.errorMessage,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get startedAtMs => $composableBuilder(
      column: $table.startedAtMs, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get completedAtMs => $composableBuilder(
      column: $table.completedAtMs,
      builder: (column) => ColumnOrderings(column));
}

class $$GitActionLogTableTableAnnotationComposer
    extends Composer<_$UxnanDatabase, $GitActionLogTableTable> {
  $$GitActionLogTableTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get threadId =>
      $composableBuilder(column: $table.threadId, builder: (column) => column);

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<String> get paramsJson => $composableBuilder(
      column: $table.paramsJson, builder: (column) => column);

  GeneratedColumn<String> get resultJson => $composableBuilder(
      column: $table.resultJson, builder: (column) => column);

  GeneratedColumn<String> get errorMessage => $composableBuilder(
      column: $table.errorMessage, builder: (column) => column);

  GeneratedColumn<int> get startedAtMs => $composableBuilder(
      column: $table.startedAtMs, builder: (column) => column);

  GeneratedColumn<int> get completedAtMs => $composableBuilder(
      column: $table.completedAtMs, builder: (column) => column);
}

class $$GitActionLogTableTableTableManager extends RootTableManager<
    _$UxnanDatabase,
    $GitActionLogTableTable,
    GitActionLogRow,
    $$GitActionLogTableTableFilterComposer,
    $$GitActionLogTableTableOrderingComposer,
    $$GitActionLogTableTableAnnotationComposer,
    $$GitActionLogTableTableCreateCompanionBuilder,
    $$GitActionLogTableTableUpdateCompanionBuilder,
    (
      GitActionLogRow,
      BaseReferences<_$UxnanDatabase, $GitActionLogTableTable, GitActionLogRow>
    ),
    GitActionLogRow,
    PrefetchHooks Function()> {
  $$GitActionLogTableTableTableManager(
      _$UxnanDatabase db, $GitActionLogTableTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$GitActionLogTableTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$GitActionLogTableTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$GitActionLogTableTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> threadId = const Value.absent(),
            Value<String> kind = const Value.absent(),
            Value<String> status = const Value.absent(),
            Value<String> paramsJson = const Value.absent(),
            Value<String?> resultJson = const Value.absent(),
            Value<String?> errorMessage = const Value.absent(),
            Value<int> startedAtMs = const Value.absent(),
            Value<int?> completedAtMs = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              GitActionLogTableCompanion(
            id: id,
            threadId: threadId,
            kind: kind,
            status: status,
            paramsJson: paramsJson,
            resultJson: resultJson,
            errorMessage: errorMessage,
            startedAtMs: startedAtMs,
            completedAtMs: completedAtMs,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String threadId,
            required String kind,
            required String status,
            required String paramsJson,
            Value<String?> resultJson = const Value.absent(),
            Value<String?> errorMessage = const Value.absent(),
            required int startedAtMs,
            Value<int?> completedAtMs = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              GitActionLogTableCompanion.insert(
            id: id,
            threadId: threadId,
            kind: kind,
            status: status,
            paramsJson: paramsJson,
            resultJson: resultJson,
            errorMessage: errorMessage,
            startedAtMs: startedAtMs,
            completedAtMs: completedAtMs,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$GitActionLogTableTableProcessedTableManager = ProcessedTableManager<
    _$UxnanDatabase,
    $GitActionLogTableTable,
    GitActionLogRow,
    $$GitActionLogTableTableFilterComposer,
    $$GitActionLogTableTableOrderingComposer,
    $$GitActionLogTableTableAnnotationComposer,
    $$GitActionLogTableTableCreateCompanionBuilder,
    $$GitActionLogTableTableUpdateCompanionBuilder,
    (
      GitActionLogRow,
      BaseReferences<_$UxnanDatabase, $GitActionLogTableTable, GitActionLogRow>
    ),
    GitActionLogRow,
    PrefetchHooks Function()>;
typedef $$ConnectionSessionsTableTableCreateCompanionBuilder
    = ConnectionSessionsTableCompanion Function({
  required String id,
  required String deviceId,
  required String transport,
  Value<String?> endpoint,
  required int startedAtMs,
  required int lastActiveAtMs,
  Value<int?> endedAtMs,
  Value<int> rowid,
});
typedef $$ConnectionSessionsTableTableUpdateCompanionBuilder
    = ConnectionSessionsTableCompanion Function({
  Value<String> id,
  Value<String> deviceId,
  Value<String> transport,
  Value<String?> endpoint,
  Value<int> startedAtMs,
  Value<int> lastActiveAtMs,
  Value<int?> endedAtMs,
  Value<int> rowid,
});

class $$ConnectionSessionsTableTableFilterComposer
    extends Composer<_$UxnanDatabase, $ConnectionSessionsTableTable> {
  $$ConnectionSessionsTableTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get deviceId => $composableBuilder(
      column: $table.deviceId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get transport => $composableBuilder(
      column: $table.transport, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get endpoint => $composableBuilder(
      column: $table.endpoint, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get startedAtMs => $composableBuilder(
      column: $table.startedAtMs, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get lastActiveAtMs => $composableBuilder(
      column: $table.lastActiveAtMs,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get endedAtMs => $composableBuilder(
      column: $table.endedAtMs, builder: (column) => ColumnFilters(column));
}

class $$ConnectionSessionsTableTableOrderingComposer
    extends Composer<_$UxnanDatabase, $ConnectionSessionsTableTable> {
  $$ConnectionSessionsTableTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get deviceId => $composableBuilder(
      column: $table.deviceId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get transport => $composableBuilder(
      column: $table.transport, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get endpoint => $composableBuilder(
      column: $table.endpoint, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get startedAtMs => $composableBuilder(
      column: $table.startedAtMs, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get lastActiveAtMs => $composableBuilder(
      column: $table.lastActiveAtMs,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get endedAtMs => $composableBuilder(
      column: $table.endedAtMs, builder: (column) => ColumnOrderings(column));
}

class $$ConnectionSessionsTableTableAnnotationComposer
    extends Composer<_$UxnanDatabase, $ConnectionSessionsTableTable> {
  $$ConnectionSessionsTableTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get deviceId =>
      $composableBuilder(column: $table.deviceId, builder: (column) => column);

  GeneratedColumn<String> get transport =>
      $composableBuilder(column: $table.transport, builder: (column) => column);

  GeneratedColumn<String> get endpoint =>
      $composableBuilder(column: $table.endpoint, builder: (column) => column);

  GeneratedColumn<int> get startedAtMs => $composableBuilder(
      column: $table.startedAtMs, builder: (column) => column);

  GeneratedColumn<int> get lastActiveAtMs => $composableBuilder(
      column: $table.lastActiveAtMs, builder: (column) => column);

  GeneratedColumn<int> get endedAtMs =>
      $composableBuilder(column: $table.endedAtMs, builder: (column) => column);
}

class $$ConnectionSessionsTableTableTableManager extends RootTableManager<
    _$UxnanDatabase,
    $ConnectionSessionsTableTable,
    ConnectionSessionRow,
    $$ConnectionSessionsTableTableFilterComposer,
    $$ConnectionSessionsTableTableOrderingComposer,
    $$ConnectionSessionsTableTableAnnotationComposer,
    $$ConnectionSessionsTableTableCreateCompanionBuilder,
    $$ConnectionSessionsTableTableUpdateCompanionBuilder,
    (
      ConnectionSessionRow,
      BaseReferences<_$UxnanDatabase, $ConnectionSessionsTableTable,
          ConnectionSessionRow>
    ),
    ConnectionSessionRow,
    PrefetchHooks Function()> {
  $$ConnectionSessionsTableTableTableManager(
      _$UxnanDatabase db, $ConnectionSessionsTableTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ConnectionSessionsTableTableFilterComposer(
                  $db: db, $table: table),
          createOrderingComposer: () =>
              $$ConnectionSessionsTableTableOrderingComposer(
                  $db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ConnectionSessionsTableTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> deviceId = const Value.absent(),
            Value<String> transport = const Value.absent(),
            Value<String?> endpoint = const Value.absent(),
            Value<int> startedAtMs = const Value.absent(),
            Value<int> lastActiveAtMs = const Value.absent(),
            Value<int?> endedAtMs = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ConnectionSessionsTableCompanion(
            id: id,
            deviceId: deviceId,
            transport: transport,
            endpoint: endpoint,
            startedAtMs: startedAtMs,
            lastActiveAtMs: lastActiveAtMs,
            endedAtMs: endedAtMs,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String deviceId,
            required String transport,
            Value<String?> endpoint = const Value.absent(),
            required int startedAtMs,
            required int lastActiveAtMs,
            Value<int?> endedAtMs = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ConnectionSessionsTableCompanion.insert(
            id: id,
            deviceId: deviceId,
            transport: transport,
            endpoint: endpoint,
            startedAtMs: startedAtMs,
            lastActiveAtMs: lastActiveAtMs,
            endedAtMs: endedAtMs,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$ConnectionSessionsTableTableProcessedTableManager
    = ProcessedTableManager<
        _$UxnanDatabase,
        $ConnectionSessionsTableTable,
        ConnectionSessionRow,
        $$ConnectionSessionsTableTableFilterComposer,
        $$ConnectionSessionsTableTableOrderingComposer,
        $$ConnectionSessionsTableTableAnnotationComposer,
        $$ConnectionSessionsTableTableCreateCompanionBuilder,
        $$ConnectionSessionsTableTableUpdateCompanionBuilder,
        (
          ConnectionSessionRow,
          BaseReferences<_$UxnanDatabase, $ConnectionSessionsTableTable,
              ConnectionSessionRow>
        ),
        ConnectionSessionRow,
        PrefetchHooks Function()>;

class $UxnanDatabaseManager {
  final _$UxnanDatabase _db;
  $UxnanDatabaseManager(this._db);
  $$ThreadsTableTableTableManager get threadsTable =>
      $$ThreadsTableTableTableManager(_db, _db.threadsTable);
  $$MessagesTableTableTableManager get messagesTable =>
      $$MessagesTableTableTableManager(_db, _db.messagesTable);
  $$TurnsTableTableTableManager get turnsTable =>
      $$TurnsTableTableTableManager(_db, _db.turnsTable);
  $$ProjectsTableTableTableManager get projectsTable =>
      $$ProjectsTableTableTableManager(_db, _db.projectsTable);
  $$TrustedDevicesTableTableTableManager get trustedDevicesTable =>
      $$TrustedDevicesTableTableTableManager(_db, _db.trustedDevicesTable);
  $$ComposerDraftsTableTableTableManager get composerDraftsTable =>
      $$ComposerDraftsTableTableTableManager(_db, _db.composerDraftsTable);
  $$GitActionLogTableTableTableManager get gitActionLogTable =>
      $$GitActionLogTableTableTableManager(_db, _db.gitActionLogTable);
  $$ConnectionSessionsTableTableTableManager get connectionSessionsTable =>
      $$ConnectionSessionsTableTableTableManager(
          _db, _db.connectionSessionsTable);
}
