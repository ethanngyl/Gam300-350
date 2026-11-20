#pragma once

#include "../Manager/StressTestRunner.h"

#include <QWidget>

#include <vector>

class QTableWidget;

class StressTestPanel : public QWidget {
	Q_OBJECT

public:
	explicit StressTestPanel(QWidget* parent = nullptr);
	~StressTestPanel() override;

	//Appends one row per result to the table
	void AddResults(const std::vector<StressResult>& results);

	//Singal to run various stress tests
signals:
	void loadTestRequested();

private:
	QTableWidget* m_results = nullptr;
};
